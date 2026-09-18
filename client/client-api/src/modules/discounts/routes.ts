import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  brands,
  categories,
  collections,
  customers,
  discountCustomers,
  discountRedemptions,
  discounts,
  orders,
  paymentBanks,
  paymentMethods,
  productVariants,
  products,
  storeSettings,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import {
  CUSTOMER_GROUPS,
  DISCOUNT_STATES,
  DISCOUNT_STRATEGIES,
  DISCOUNT_KINDS,
  PAYMENT_CONDITIONS,
  PROVIDER_CHANNELS,
  cardPrefixSchema,
  discountInputSchema,
  type DiscountInput,
} from '../../lib/discounts/rules';
import { instantToWallTime, isValidTimeZone, wallTimeToInstant } from '../../lib/discounts/zoned-time';
import { AppError, ERROR_CODES, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { loadStoreCurrency } from '../../lib/store-currency';
import { storeOf } from '../../plugins/tenant';

type DiscountRow = typeof discounts.$inferSelect;

/**
 * What the list shows instead of the stored status.
 *
 * Draft and paused are the owner's word; everything else is read off the clock
 * and the counter at the moment of asking, so a sale that ended at midnight
 * says so at 00:00:01 without anything having run.
 */
const stateSql = sql<string>`(case
  when ${discounts.status} = 'draft' then 'draft'
  when ${discounts.status} = 'paused' then 'paused'
  when ${discounts.endsAt} is not null and ${discounts.endsAt} <= now() then 'expired'
  when ${discounts.usageLimit} is not null and ${discounts.usedCount} >= ${discounts.usageLimit} then 'limit_reached'
  when ${discounts.startsAt} is not null and ${discounts.startsAt} > now() then 'scheduled'
  else 'active'
end)`;

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', ...DISCOUNT_STATES]).optional(),
  kind: z.enum(DISCOUNT_KINDS).optional(),
  customer: z.enum(['all', 'new', 'returning', 'vip', 'groups', 'selected']).optional(),
  payment: z.enum(PAYMENT_CONDITIONS).or(z.literal('bank')).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const lookupQuerySchema = z.object({
  type: z.enum(['products', 'variants', 'categories', 'brands', 'collections', 'customers', 'banks']),
  search: z.string().trim().max(120).optional(),
  ids: z
    .string()
    .trim()
    .max(20_000)
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => z.string().uuid().safeParse(id).success)
        .slice(0, 500),
    ),
});

const statusBodySchema = z.object({ status: z.enum(['draft', 'active', 'paused']) });
const settingsBodySchema = z.object({ strategy: z.enum(DISCOUNT_STRATEGIES) });
const generateBodySchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .max(12)
    .regex(/^[A-Z0-9]*$/, 'Letters and numbers only.')
    .optional(),
});

const bankBodySchema = z.object({
  name: z.string().trim().min(2, 'Enter the bank’s name.').max(120),
  shortName: z.string().trim().max(40).nullable().default(null),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code.')
    .default('BD'),
  cardPrefixes: z
    .array(cardPrefixSchema)
    .max(500)
    .default([])
    .refine(
      (entries) => new Set(entries.map((entry) => entry.prefix)).size === entries.length,
      'Each card prefix only needs to be listed once.',
    ),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

// ------------------------------------------------------------- helpers --

/** Everything a stored discount's rules point at, by what it is. */
function referencesOf(row: Pick<DiscountRow, 'productRules' | 'purchaseRules' | 'rewardRules' | 'paymentRules'>) {
  const product = row.productRules ?? {};
  const purchase = row.purchaseRules ?? {};
  const reward = row.rewardRules ?? {};
  const payment = row.paymentRules ?? {};
  return {
    products: [
      ...(product.productIds ?? []),
      ...(product.excludeProductIds ?? []),
      ...(purchase.requiredProductIds ?? []),
      ...(reward.buyProductIds ?? []),
      ...(reward.getProductIds ?? []),
    ],
    variants: [...(product.variantIds ?? [])],
    categories: [
      ...(product.categoryIds ?? []),
      ...(product.excludeCategoryIds ?? []),
      ...(purchase.requiredCategoryIds ?? []),
      ...(reward.buyCategoryIds ?? []),
      ...(reward.getCategoryIds ?? []),
    ],
    brands: [...(product.brandIds ?? []), ...(product.excludeBrandIds ?? []), ...(purchase.requiredBrandIds ?? [])],
    collections: [...(product.collectionIds ?? [])],
    banks: [...(payment.bankIds ?? [])],
  };
}

type References = ReturnType<typeof referencesOf>;
type Label = { label: string; sublabel: string | null };

/**
 * Names for every id a set of rules names, so the panel can print "Google Pixel"
 * rather than a uuid — six small batched reads rather than one per chip.
 */
async function resolveLabels(db: TenantExecutor, refs: References): Promise<Record<string, Label>> {
  const unique = (ids: string[]) => [...new Set(ids)];
  const out: Record<string, Label> = {};
  const [productRows, variantRows, categoryRows, brandRows, collectionRows, bankRows] = await Promise.all([
    refs.products.length
      ? db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, unique(refs.products)))
      : [],
    refs.variants.length
      ? db
          .select({ id: productVariants.id, sku: productVariants.sku, title: productVariants.title, product: products.name })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(inArray(productVariants.id, unique(refs.variants)))
      : [],
    refs.categories.length
      ? db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, unique(refs.categories)))
      : [],
    refs.brands.length
      ? db.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.id, unique(refs.brands)))
      : [],
    refs.collections.length
      ? db
          .select({ id: collections.id, name: collections.name })
          .from(collections)
          .where(inArray(collections.id, unique(refs.collections)))
      : [],
    refs.banks.length
      ? db.select({ id: paymentBanks.id, name: paymentBanks.name }).from(paymentBanks).where(inArray(paymentBanks.id, unique(refs.banks)))
      : [],
  ]);

  for (const row of productRows) out[row.id] = { label: row.name, sublabel: null };
  for (const row of variantRows) out[row.id] = { label: `${row.product}${row.title ? ` — ${row.title}` : ''}`, sublabel: row.sku };
  for (const row of categoryRows) out[row.id] = { label: row.name, sublabel: null };
  for (const row of brandRows) out[row.id] = { label: row.name, sublabel: null };
  for (const row of collectionRows) out[row.id] = { label: row.name, sublabel: null };
  for (const row of bankRows) out[row.id] = { label: row.name, sublabel: null };
  return out;
}

async function storeTimezone(db: TenantExecutor): Promise<string> {
  const [row] = await db.select({ timezone: storeSettings.timezone }).from(storeSettings).limit(1);
  return row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : 'UTC';
}

/** A stored row as the panel reads it: instants as ISO, and as wall-clock times in the discount's own zone. */
function serialise(row: DiscountRow, fallbackZone: string) {
  const zone = row.timezone && isValidTimeZone(row.timezone) ? row.timezone : fallbackZone;
  return {
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    startsAtLocal: instantToWallTime(row.startsAt, zone),
    endsAtLocal: instantToWallTime(row.endsAt, zone),
    resolvedTimezone: zone,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A code nobody has used on this store, in the alphabet that reads unambiguously aloud. */
async function generateCode(db: TenantExecutor, prefix = ''): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bytes = randomBytes(8);
    const body = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
    const code = `${prefix}${prefix ? '-' : ''}${body}`.slice(0, 40);
    const [taken] = await db
      .select({ id: discounts.id })
      .from(discounts)
      .where(eq(sql`upper(${discounts.code})`, code))
      .limit(1);
    if (!taken) return code;
  }
  throw new AppError(ERROR_CODES.CONFLICT, 'A unique code could not be generated. Try again.', 409);
}

/**
 * Refuses a body that names something this store does not have.
 *
 * The pickers are built from this store's own catalogue, so an unknown id is a
 * stale form or somebody probing; both deserve the same plain per-field 422.
 * Two refusals here are about honesty rather than integrity: a bank offer
 * naming a bank with no card prefixes, and a credit- or debit-card condition
 * with no bank listing a prefix of that type, could never match a card — the
 * shop would believe an offer was running that nobody can receive.
 */
async function assertReferences(db: TenantExecutor, body: DiscountInput): Promise<void> {
  const details: Record<string, string[]> = {};
  const complain = (field: string, message: string) => (details[field] ??= []).push(message);

  const check = async (field: string, ids: string[], table: 'products' | 'variants' | 'categories' | 'brands' | 'collections' | 'customers') => {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return;
    const source = {
      products: { t: products, id: products.id },
      variants: { t: productVariants, id: productVariants.id },
      categories: { t: categories, id: categories.id },
      brands: { t: brands, id: brands.id },
      collections: { t: collections, id: collections.id },
      customers: { t: customers, id: customers.id },
    }[table];
    const found = await db.select({ id: source.id }).from(source.t).where(inArray(source.id, wanted));
    if (found.length !== wanted.length) complain(field, 'Something picked here no longer exists. Pick again.');
  };

  const p = body.productRules;
  await Promise.all([
    check('productRules.productIds', [...p.productIds, ...p.excludeProductIds], 'products'),
    check('productRules.variantIds', p.variantIds, 'variants'),
    check('productRules.categoryIds', [...p.categoryIds, ...p.excludeCategoryIds], 'categories'),
    check('productRules.brandIds', [...p.brandIds, ...p.excludeBrandIds], 'brands'),
    check('productRules.collectionIds', p.collectionIds, 'collections'),
    check('purchaseRules.requiredProductIds', body.purchaseRules.requiredProductIds, 'products'),
    check('purchaseRules.requiredCategoryIds', body.purchaseRules.requiredCategoryIds, 'categories'),
    check('purchaseRules.requiredBrandIds', body.purchaseRules.requiredBrandIds, 'brands'),
    check('rewardRules.buyProductIds', [...body.rewardRules.buyProductIds, ...body.rewardRules.getProductIds], 'products'),
    check('rewardRules.buyCategoryIds', [...body.rewardRules.buyCategoryIds, ...body.rewardRules.getCategoryIds], 'categories'),
    check('customerIds', body.customerIds, 'customers'),
  ]);

  if (body.timezone && !isValidTimeZone(body.timezone)) complain('timezone', 'Pick a timezone from the list.');

  const bankIds = body.paymentRules.bankIds;
  const channels = body.paymentRules.channels;
  if (bankIds.length > 0 || channels.includes('credit_card') || channels.includes('debit_card')) {
    const banks = await db
      .select({ id: paymentBanks.id, name: paymentBanks.name, prefixes: paymentBanks.cardPrefixes, isActive: paymentBanks.isActive })
      .from(paymentBanks);
    const byId = new Map(banks.map((bank) => [bank.id, bank]));

    for (const id of bankIds) {
      const bank = byId.get(id);
      if (!bank) {
        complain('paymentRules.bankIds', 'A bank picked here no longer exists. Pick again.');
        continue;
      }
      const usable = (bank.prefixes ?? []).filter(
        (entry) =>
          body.paymentRules.cardTypes.length === 0 ||
          (entry.cardType !== null && body.paymentRules.cardTypes.includes(entry.cardType)),
      );
      if (usable.length === 0) {
        const typeWord = body.paymentRules.cardTypes.length ? `${body.paymentRules.cardTypes.join(' or ')} ` : '';
        throw unprocessable(
          `${bank.name} has no ${typeWord}card prefixes on file, so no card could qualify. Add them under Manage banks first.`,
          ERROR_CODES.DISCOUNT_BANK_UNVERIFIABLE,
          { 'paymentRules.bankIds': [`Add ${bank.name}’s card prefixes under Manage banks first.`] },
        );
      }
      if (!bank.isActive) complain('paymentRules.bankIds', `${bank.name} is switched off under Manage banks.`);
    }

    for (const wanted of ['credit', 'debit'] as const) {
      if (!channels.includes(`${wanted}_card`)) continue;
      const known = banks.some((bank) => bank.isActive && (bank.prefixes ?? []).some((entry) => entry.cardType === wanted));
      if (!known) {
        complain(
          'paymentRules.channels',
          `No bank on file lists a ${wanted} card prefix, so a ${wanted} card cannot be recognised. Add prefixes under Manage banks.`,
        );
      }
    }
  }

  if (Object.keys(details).length > 0) {
    throw unprocessable('Some fields need your attention.', ERROR_CODES.VALIDATION_FAILED, details);
  }
}

async function assertCodeFree(db: TenantExecutor, code: string | null, exceptId: string | null): Promise<void> {
  if (!code) return;
  const [clash] = await db
    .select({ id: discounts.id, archivedAt: discounts.archivedAt })
    .from(discounts)
    .where(and(eq(sql`upper(${discounts.code})`, code), exceptId ? ne(discounts.id, exceptId) : undefined))
    .limit(1);

  if (clash) {
    const message = clash.archivedAt
      ? 'That code belonged to a deleted discount that customers used, so it cannot be reused.'
      : 'That code is already in use.';
    throw new AppError(ERROR_CODES.DISCOUNT_CODE_TAKEN, message, 409, { details: { code: [message] } });
  }
}

/** The columns a body writes, with its wall-clock times turned into instants in the right zone. */
async function valuesFrom(db: TenantExecutor, body: DiscountInput) {
  const zone = body.timezone ?? (await storeTimezone(db));
  return {
    kind: body.kind,
    name: body.name,
    code: body.code,
    title: body.title,
    summary: body.summary,
    notes: body.notes,
    valueType: body.valueType,
    value: body.value,
    maxDiscountAmount: body.maxDiscountAmount,
    minOrderAmount: body.minOrderAmount,
    minQuantity: body.minQuantity,
    maxDiscountedQuantity: body.maxDiscountedQuantity,
    minSubtotalAfterDiscount: body.minSubtotalAfterDiscount,
    productRules: body.productRules,
    purchaseRules: body.purchaseRules,
    rewardRules: body.rewardRules,
    customerRules: body.customerRules,
    paymentRules: body.paymentRules,
    areaRules: body.areaRules,
    scheduleRules: body.scheduleRules,
    combinationRules: body.combinationRules,
    issueRules: body.issueRules,
    usageLimit: body.usageLimit,
    perCustomerLimit: body.perCustomerLimit,
    cooldownAmount: body.cooldownAmount,
    cooldownUnit: body.cooldownUnit,
    startsAt: body.startsAt ? wallTimeToInstant(body.startsAt, zone) : null,
    endsAt: body.endsAt ? wallTimeToInstant(body.endsAt, zone) : null,
    timezone: body.timezone,
    priority: body.priority,
    status: body.status,
  };
}

/**
 * Makes a discount's named customers exactly the list the editor sent.
 *
 * Only the owner's own entries move. A voucher a rule issued, or one somebody
 * has already spent, is history and stays whatever the list now says — removing
 * a customer from a voucher must not un-spend the order they used it on.
 */
async function syncCustomers(db: TenantExecutor, discountId: string, customerIds: string[]): Promise<void> {
  const keep = new Set(customerIds);
  const existing = await db
    .select({ id: discountCustomers.id, customerId: discountCustomers.customerId, usedAt: discountCustomers.usedAt })
    .from(discountCustomers)
    .where(and(eq(discountCustomers.discountId, discountId), eq(discountCustomers.source, 'manual')));

  const stale = existing.filter((row) => !keep.has(row.customerId) && !row.usedAt).map((row) => row.id);
  if (stale.length > 0) await db.delete(discountCustomers).where(inArray(discountCustomers.id, stale));

  const present = new Set(existing.map((row) => row.customerId));
  const fresh = customerIds.filter((id) => !present.has(id));
  if (fresh.length > 0) {
    await db
      .insert(discountCustomers)
      .values(fresh.map((customerId) => ({ discountId, customerId, source: 'manual' as const })))
      .onConflictDoNothing();
  }
}

function hasCustomersView(request: FastifyRequest): boolean {
  return request.storeAdmin?.permissions.has('customers.view') ?? false;
}

// ----------------------------------------------------------------- routes --

/**
 * The Discounts screen: every coupon, voucher, automatic, bank and payment offer.
 *
 * `marketing.view` reads and `marketing.manage` writes, like the rest of the
 * marketing section — there are no per-feature keys in the seeded permission
 * catalogue and inventing some here would put the API out of step with every
 * store that already exists. Naming customers is the exception: looking them up
 * also needs `customers.view`, because a customer picker is a customer search.
 *
 * `used_count` is never written here. It is claimed in the order transaction
 * and handed back when an order is cancelled, which makes it the live count the
 * usage limit is checked against.
 */
export default async function discountRoutes(app: FastifyInstance) {
  // The storefront's "Coupon Available" filter reads this table.
  invalidateStorefrontOnWrite(app);

  const view = { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] };
  const manage = { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] };

  // ------------------------------------------------------------------ list --
  app.get('/discounts', view, async (request, reply) => {
    const store = storeOf(request);
    const query = parseQuery(listQuerySchema, request.query);
    const zone = await storeTimezone(store.db);

    const filters: (SQL | undefined)[] = [
      isNull(discounts.archivedAt),
      query.search
        ? or(
            ilike(discounts.name, `%${query.search}%`),
            ilike(discounts.code, `%${query.search}%`),
            ilike(discounts.title, `%${query.search}%`),
            ilike(discounts.notes, `%${query.search}%`),
          )
        : undefined,
      query.status && query.status !== 'all' ? sql`${stateSql} = ${query.status}` : undefined,
      query.kind ? eq(discounts.kind, query.kind) : undefined,
      query.customer && query.customer !== 'all'
        ? sql`coalesce(${discounts.customerRules}->>'segment', 'all') = ${query.customer}`
        : undefined,
      query.payment === 'bank'
        ? sql`jsonb_array_length(coalesce(${discounts.paymentRules}->'bankIds', '[]'::jsonb)) > 0`
        : query.payment
          ? sql`coalesce(${discounts.paymentRules}->'channels', '[]'::jsonb) ? ${query.payment}`
          : undefined,
      // Live at any moment of the chosen days, read in the store's own clock.
      query.to ? sql`(${discounts.startsAt} is null or ${discounts.startsAt} <= ${wallTimeToInstant(`${query.to}T23:59`, zone)})` : undefined,
      query.from ? sql`(${discounts.endsAt} is null or ${discounts.endsAt} >= ${wallTimeToInstant(`${query.from}T00:00`, zone)})` : undefined,
    ];
    const where = and(...filters.filter(Boolean));

    const page = keyset<{ discount: { id: string; createdAt: Date } }>([
      { expr: discounts.createdAt, order: 'desc', of: (row) => row.discount.createdAt },
      { expr: discounts.id, order: 'desc', of: (row) => row.discount.id },
    ]);
    const seek = page.after(query.cursor);

    const [rows, tally] = await Promise.all([
      store.db
        .select({
          discount: discounts,
          state: stateSql,
          customerCount: sql<number>`(select count(*)::int from ${discountCustomers} dc where dc.discount_id = ${discounts.id})`,
        })
        .from(discounts)
        .where(seek ? and(seek, where) : where)
        .orderBy(...page.orderBy)
        .limit(query.pageSize + 1)
        .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),
      query.cursor ? undefined : store.db.select({ total: count() }).from(discounts).where(where),
    ]);

    const batch = page.batch(rows, query.pageSize);

    const refs = batch.rows.reduce<References>(
      (all, row) => {
        const next = referencesOf(row.discount);
        for (const key of Object.keys(all) as (keyof References)[]) all[key].push(...next[key]);
        return all;
      },
      { products: [], variants: [], categories: [], brands: [], collections: [], banks: [] },
    );
    const labels = await resolveLabels(store.db, refs);

    return listed(
      reply,
      batch.rows.map((row) => {
        const own = referencesOf(row.discount);
        const mine = Object.values(own).flat();
        return {
          ...serialise(row.discount, zone),
          state: row.state,
          customerCount: Number(row.customerCount),
          labels: Object.fromEntries(mine.filter((id) => labels[id]).map((id) => [id, labels[id]!.label])),
        };
      }),
      {
        pageSize: query.pageSize,
        nextCursor: batch.nextCursor,
        hasMore: batch.hasMore,
        total: tally ? Number(tally[0]?.total ?? 0) : undefined,
      },
    );
  });

  // --------------------------------------------------------------- summary --
  app.get('/discounts/summary', view, async (request, reply) => {
    const store = storeOf(request);
    const currency = await loadStoreCurrency(store);

    const [states, [ledger]] = await Promise.all([
      store.db
        .select({ state: stateSql, total: count() })
        .from(discounts)
        .where(isNull(discounts.archivedAt))
        .groupBy(stateSql),
      store.db
        .select({
          redemptions: sql<number>`count(*) filter (where ${discountRedemptions.voidedAt} is null)::int`,
          orders: sql<number>`count(distinct ${discountRedemptions.orderId}) filter (where ${discountRedemptions.voidedAt} is null)::int`,
          // Money in the store's current currency only: a sum of dollars and taka is not a figure.
          given: sql<string>`coalesce(sum(${discountRedemptions.discountAmount}) filter (
            where ${discountRedemptions.voidedAt} is null and (${orders.currency} is null or ${orders.currency} = ${currency})
          ), 0)::text`,
          last30: sql<number>`count(*) filter (where ${discountRedemptions.voidedAt} is null and ${discountRedemptions.createdAt} >= now() - interval '30 days')::int`,
        })
        .from(discountRedemptions)
        .leftJoin(orders, eq(orders.id, discountRedemptions.orderId)),
    ]);

    const by = Object.fromEntries(states.map((row) => [row.state, Number(row.total)]));
    return ok(reply, {
      active: by.active ?? 0,
      scheduled: by.scheduled ?? 0,
      paused: by.paused ?? 0,
      expired: by.expired ?? 0,
      draft: by.draft ?? 0,
      limitReached: by.limit_reached ?? 0,
      total: states.reduce((sum, row) => sum + Number(row.total), 0),
      redemptions: Number(ledger?.redemptions ?? 0),
      redemptionsLast30Days: Number(ledger?.last30 ?? 0),
      discountedOrders: Number(ledger?.orders ?? 0),
      discountGiven: ledger?.given ?? '0',
      currency,
    });
  });

  // ------------------------------------------------------------- reference --
  /** What the editor's pickers and hints are built from, in one read. */
  app.get('/discounts/reference', view, async (request, reply) => {
    const store = storeOf(request);
    const [[settings], bankRows, collectionRows, methodRows, [birthdays], currency] = await Promise.all([
      store.db.select({ timezone: storeSettings.timezone, preferences: storeSettings.preferences }).from(storeSettings).limit(1),
      store.db.select().from(paymentBanks).orderBy(asc(paymentBanks.sortOrder), asc(paymentBanks.name)),
      store.db.select({ id: collections.id, name: collections.name }).from(collections).orderBy(asc(collections.sortOrder)),
      store.db
        .select({ provider: paymentMethods.provider, label: paymentMethods.label, isEnabled: paymentMethods.isEnabled })
        .from(paymentMethods)
        .orderBy(asc(paymentMethods.sortOrder)),
      store.db.select({ total: count() }).from(customers).where(sql`${customers.birthDate} is not null`),
      loadStoreCurrency(store),
    ]);

    return ok(reply, {
      timezone: settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC',
      strategy: settings?.preferences?.discountStrategy ?? 'best',
      currency,
      banks: bankRows.map((bank) => ({
        ...bank,
        createdAt: bank.createdAt.toISOString(),
        updatedAt: bank.updatedAt.toISOString(),
      })),
      collections: collectionRows,
      paymentMethods: methodRows.map((method) => ({
        ...method,
        channels: PROVIDER_CHANNELS[method.provider] ?? [],
      })),
      customerGroups: CUSTOMER_GROUPS,
      customersWithBirthday: Number(birthdays?.total ?? 0),
      canSearchCustomers: hasCustomersView(request),
    });
  });

  // ---------------------------------------------------------------- lookup --
  /**
   * The searchable pickers: a few matches for what was typed, or exact names for
   * ids already chosen. One endpoint for six kinds of thing, because they all
   * answer the same question with the same shape.
   */
  app.get('/discounts/lookup', view, async (request, reply) => {
    const store = storeOf(request);
    const query = parseQuery(lookupQuerySchema, request.query);
    const term = query.search ? `%${query.search}%` : null;
    const byIds = query.ids.length > 0;
    const limit = byIds ? 500 : 20;

    if (query.type === 'customers' && !hasCustomersView(request)) {
      throw forbidden('Looking up customers needs permission to view customers.', ERROR_CODES.PERMISSION_DENIED);
    }

    const options = await (async (): Promise<{ id: string; label: string; sublabel: string | null }[]> => {
      switch (query.type) {
        case 'products':
          return store.db
            .select({ id: products.id, label: products.name, sublabel: products.status })
            .from(products)
            .where(byIds ? inArray(products.id, query.ids) : term ? ilike(products.name, term) : undefined)
            .orderBy(asc(products.name))
            .limit(limit);
        case 'variants':
          return (
            await store.db
              .select({ id: productVariants.id, product: products.name, title: productVariants.title, sku: productVariants.sku })
              .from(productVariants)
              .innerJoin(products, eq(products.id, productVariants.productId))
              .where(
                byIds
                  ? inArray(productVariants.id, query.ids)
                  : term
                    ? or(ilike(productVariants.sku, term), ilike(products.name, term), ilike(productVariants.title, term))
                    : undefined,
              )
              .orderBy(asc(products.name), asc(productVariants.sku))
              .limit(limit)
          ).map((row) => ({ id: row.id, label: `${row.product}${row.title ? ` — ${row.title}` : ''}`, sublabel: row.sku }));
        case 'categories': {
          const rows = await store.db
            .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
            .from(categories)
            .orderBy(asc(categories.name));
          const names = new Map(rows.map((row) => [row.id, row.name]));
          return rows
            .filter((row) => (byIds ? query.ids.includes(row.id) : !query.search || row.name.toLowerCase().includes(query.search.toLowerCase())))
            .slice(0, byIds ? 500 : 50)
            .map((row) => ({ id: row.id, label: row.name, sublabel: row.parentId ? `in ${names.get(row.parentId) ?? '…'}` : null }));
        }
        case 'brands':
          return store.db
            .select({ id: brands.id, label: brands.name, sublabel: sql<string | null>`null` })
            .from(brands)
            .where(byIds ? inArray(brands.id, query.ids) : term ? ilike(brands.name, term) : undefined)
            .orderBy(asc(brands.name))
            .limit(byIds ? 500 : 50);
        case 'collections':
          return store.db
            .select({ id: collections.id, label: collections.name, sublabel: sql<string | null>`null` })
            .from(collections)
            .where(byIds ? inArray(collections.id, query.ids) : term ? ilike(collections.name, term) : undefined)
            .orderBy(asc(collections.name))
            .limit(byIds ? 500 : 50);
        case 'banks':
          return (
            await store.db
              .select({ id: paymentBanks.id, name: paymentBanks.name, prefixes: paymentBanks.cardPrefixes, isActive: paymentBanks.isActive })
              .from(paymentBanks)
              .where(byIds ? inArray(paymentBanks.id, query.ids) : term ? ilike(paymentBanks.name, term) : undefined)
              .orderBy(asc(paymentBanks.sortOrder), asc(paymentBanks.name))
              .limit(byIds ? 500 : 100)
          ).map((row) => ({
            id: row.id,
            label: row.name,
            sublabel: `${(row.prefixes ?? []).length} card ${(row.prefixes ?? []).length === 1 ? 'prefix' : 'prefixes'}${row.isActive ? '' : ' · switched off'}`,
          }));
        case 'customers':
          return (
            await store.db
              .select({ id: customers.id, name: customers.fullName, email: customers.email, phone: customers.phone })
              .from(customers)
              .where(
                byIds
                  ? inArray(customers.id, query.ids)
                  : term
                    ? or(ilike(customers.fullName, term), ilike(customers.email, term), ilike(customers.phone, term))
                    : undefined,
              )
              .orderBy(desc(customers.createdAt))
              .limit(limit)
          ).map((row) => ({ id: row.id, label: row.name, sublabel: row.email ?? row.phone }));
      }
    })();

    return ok(reply, options);
  });

  // -------------------------------------------------------------- settings --
  app.put('/discounts/settings', manage, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(settingsBodySchema, request.body);

    await store.db
      .update(storeSettings)
      .set({
        preferences: sql`jsonb_set(coalesce(${storeSettings.preferences}, '{}'::jsonb), '{discountStrategy}', to_jsonb(${body.strategy}::text))`,
        updatedAt: new Date(),
      });

    await audit(store.db, request, {
      action: 'discount.strategy',
      module: 'marketing',
      entity: 'store_settings',
      newValues: body,
    });

    return ok(reply, body);
  });

  app.post('/discounts/generate-code', manage, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(generateBodySchema, request.body ?? {});
    return ok(reply, { code: await generateCode(store.db, body.prefix ?? '') });
  });

  // ----------------------------------------------------------------- banks --
  app.get('/discounts/banks', view, async (request, reply) => {
    const store = storeOf(request);
    const rows = await store.db
      .select({
        bank: paymentBanks,
        discountCount: sql<number>`(
          select count(*)::int from ${discounts} d
           where d.archived_at is null
             and coalesce(d.payment_rules->'bankIds', '[]'::jsonb) ? ${paymentBanks.id}::text
        )`,
      })
      .from(paymentBanks)
      .orderBy(asc(paymentBanks.sortOrder), asc(paymentBanks.name));

    return ok(
      reply,
      rows.map((row) => ({
        ...row.bank,
        discountCount: Number(row.discountCount),
        createdAt: row.bank.createdAt.toISOString(),
        updatedAt: row.bank.updatedAt.toISOString(),
      })),
    );
  });

  app.post('/discounts/banks', manage, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(bankBodySchema, request.body);

    const [clash] = await store.db
      .select({ id: paymentBanks.id })
      .from(paymentBanks)
      .where(eq(sql`lower(${paymentBanks.name})`, body.name.toLowerCase()))
      .limit(1);
    if (clash) throw conflict('A bank with that name is already on the list.');

    const [created] = await store.db.insert(paymentBanks).values(body).returning();

    await audit(store.db, request, {
      action: 'bank.create',
      module: 'marketing',
      entity: 'payment_bank',
      entityId: created!.id,
      entityLabel: created!.name,
      newValues: created,
    });

    return ok(reply, created, 201);
  });

  app.put('/discounts/banks/:id', manage, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);
    const body = parseBody(bankBodySchema, request.body);

    const [clash] = await store.db
      .select({ id: paymentBanks.id })
      .from(paymentBanks)
      .where(and(eq(sql`lower(${paymentBanks.name})`, body.name.toLowerCase()), ne(paymentBanks.id, id)))
      .limit(1);
    if (clash) throw conflict('A bank with that name is already on the list.');

    const [updated] = await store.db
      .update(paymentBanks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(paymentBanks.id, id))
      .returning();
    if (!updated) throw notFound('That bank does not exist.');

    await audit(store.db, request, {
      action: 'bank.update',
      module: 'marketing',
      entity: 'payment_bank',
      entityId: id,
      entityLabel: updated.name,
      newValues: updated,
    });

    return ok(reply, updated);
  });

  /** A bank a live offer still names is refused: the offer would silently stop matching any card. */
  app.delete('/discounts/banks/:id', manage, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);

    const [inUse] = await store.db
      .select({ name: discounts.name })
      .from(discounts)
      .where(
        and(isNull(discounts.archivedAt), sql`coalesce(${discounts.paymentRules}->'bankIds', '[]'::jsonb) ? ${id}`),
      )
      .limit(1);
    if (inUse) {
      throw conflict(`“${inUse.name}” still names this bank. Remove it from that discount first.`, ERROR_CODES.BANK_IN_USE);
    }

    const [removed] = await store.db
      .delete(paymentBanks)
      .where(eq(paymentBanks.id, id))
      .returning({ id: paymentBanks.id, name: paymentBanks.name });
    if (!removed) throw notFound('That bank does not exist.');

    await audit(store.db, request, {
      action: 'bank.delete',
      module: 'marketing',
      entity: 'payment_bank',
      entityId: id,
      entityLabel: removed.name,
    });

    return noContent(reply);
  });

  // ---------------------------------------------------------------- detail --
  /**
   * One discount, whole: every rule with the names behind its ids, who it names,
   * what it has done, and the ledger that is made of.
   *
   * "Order share" is the honest version of a conversion rate. Nothing on the
   * platform counts who *saw* an offer, so the rate is uses against the orders
   * placed while it was live — how much of the shop's trade it touched.
   */
  app.get('/discounts/:id', view, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);

    const [found] = await store.db
      .select({ discount: discounts, state: stateSql })
      .from(discounts)
      .where(eq(discounts.id, id))
      .limit(1);
    if (!found) throw notFound('That discount does not exist.');

    const row = found.discount;
    const [zone, currency] = await Promise.all([storeTimezone(store.db), loadStoreCurrency(store)]);
    const inCurrency = sql`(${orders.currency} is null or ${orders.currency} = ${currency})`;

    const [labels, assigned, [assignedTally], [analytics], [placed], redemptions] = await Promise.all([
      resolveLabels(store.db, referencesOf(row)),
      hasCustomersView(request)
        ? store.db
            .select({
              id: discountCustomers.id,
              customerId: discountCustomers.customerId,
              name: customers.fullName,
              email: customers.email,
              phone: customers.phone,
              source: discountCustomers.source,
              periodKey: discountCustomers.periodKey,
              issuedAt: discountCustomers.issuedAt,
              expiresAt: discountCustomers.expiresAt,
              usedAt: discountCustomers.usedAt,
              orderId: discountCustomers.orderId,
            })
            .from(discountCustomers)
            .innerJoin(customers, eq(customers.id, discountCustomers.customerId))
            .where(eq(discountCustomers.discountId, id))
            .orderBy(desc(discountCustomers.issuedAt))
            .limit(500)
        : Promise.resolve([]),
      store.db
        .select({
          total: count(),
          used: sql<number>`count(*) filter (where ${discountCustomers.usedAt} is not null)::int`,
        })
        .from(discountCustomers)
        .where(eq(discountCustomers.discountId, id)),
      store.db
        .select({
          uses: sql<number>`count(*) filter (where ${discountRedemptions.voidedAt} is null)::int`,
          voided: sql<number>`count(*) filter (where ${discountRedemptions.voidedAt} is not null)::int`,
          customers: sql<number>`count(distinct ${discountRedemptions.customerId}) filter (where ${discountRedemptions.voidedAt} is null)::int`,
          orderValue: sql<string>`coalesce(sum(${discountRedemptions.finalAmount}) filter (where ${discountRedemptions.voidedAt} is null and ${inCurrency}), 0)::text`,
          given: sql<string>`coalesce(sum(${discountRedemptions.discountAmount}) filter (where ${discountRedemptions.voidedAt} is null and ${inCurrency}), 0)::text`,
          averageOrder: sql<string>`coalesce(avg(${discountRedemptions.finalAmount}) filter (where ${discountRedemptions.voidedAt} is null and ${inCurrency}), 0)::numeric(14,2)::text`,
          firstUsedAt: sql<Date | null>`min(${discountRedemptions.createdAt})`,
          lastUsedAt: sql<Date | null>`max(${discountRedemptions.createdAt}) filter (where ${discountRedemptions.voidedAt} is null)`,
        })
        .from(discountRedemptions)
        .leftJoin(orders, eq(orders.id, discountRedemptions.orderId))
        .where(eq(discountRedemptions.discountId, id)),
      store.db
        .select({ total: count() })
        .from(orders)
        .where(
          and(
            sql`${orders.status} not in ('cancelled', 'failed')`,
            gte(orders.placedAt, row.startsAt && row.startsAt > row.createdAt ? row.startsAt : row.createdAt),
            row.endsAt ? lte(orders.placedAt, row.endsAt) : undefined,
          ),
        ),
      store.db
        .select({
          id: discountRedemptions.id,
          orderId: discountRedemptions.orderId,
          orderNumber: orders.orderNumber,
          orderStatus: orders.status,
          customerId: discountRedemptions.customerId,
          customerName: customers.fullName,
          email: sql<string | null>`coalesce(${customers.email}, ${discountRedemptions.email}, ${orders.email})`,
          code: discountRedemptions.code,
          originalAmount: discountRedemptions.originalAmount,
          discountAmount: discountRedemptions.discountAmount,
          finalAmount: discountRedemptions.finalAmount,
          currency: orders.currency,
          voidedAt: discountRedemptions.voidedAt,
          createdAt: discountRedemptions.createdAt,
        })
        .from(discountRedemptions)
        .leftJoin(orders, eq(orders.id, discountRedemptions.orderId))
        .leftJoin(customers, eq(customers.id, discountRedemptions.customerId))
        .where(eq(discountRedemptions.discountId, id))
        .orderBy(desc(discountRedemptions.createdAt))
        .limit(50),
    ]);

    const uses = Number(analytics?.uses ?? 0);
    const ordersWhileLive = Number(placed?.total ?? 0);

    return ok(reply, {
      ...serialise(row, zone),
      state: found.state,
      labels,
      customers: assigned.map((entry) => ({
        ...entry,
        issuedAt: entry.issuedAt.toISOString(),
        expiresAt: entry.expiresAt?.toISOString() ?? null,
        usedAt: entry.usedAt?.toISOString() ?? null,
      })),
      customerIds: assigned.filter((entry) => entry.source === 'manual').map((entry) => entry.customerId),
      customerCount: Number(assignedTally?.total ?? 0),
      customersUsed: Number(assignedTally?.used ?? 0),
      canSeeCustomers: hasCustomersView(request),
      analytics: {
        currency,
        uses,
        voidedUses: Number(analytics?.voided ?? 0),
        uniqueCustomers: Number(analytics?.customers ?? 0),
        orderValue: analytics?.orderValue ?? '0',
        discountGiven: analytics?.given ?? '0',
        averageOrderValue: analytics?.averageOrder ?? '0',
        ordersWhileLive,
        orderShare: ordersWhileLive > 0 ? Math.min(1, uses / ordersWhileLive) : null,
        firstUsedAt: analytics?.firstUsedAt ? new Date(analytics.firstUsedAt).toISOString() : null,
        lastUsedAt: analytics?.lastUsedAt ? new Date(analytics.lastUsedAt).toISOString() : null,
      },
      redemptions: redemptions.map((entry) => ({
        ...entry,
        voidedAt: entry.voidedAt?.toISOString() ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  });

  // ---------------------------------------------------------------- writes --
  app.post('/discounts', manage, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(discountInputSchema, request.body);
    await assertReferences(store.db, body);

    if (body.kind === 'voucher' && !body.code) body.code = await generateCode(store.db, 'V');
    await assertCodeFree(store.db, body.code, null);

    const created = await store.db.transaction(async (tx) => {
      const [row] = await tx.insert(discounts).values(await valuesFrom(tx, body)).returning();
      await syncCustomers(tx, row!.id, body.customerIds);
      return row!;
    });

    await audit(store.db, request, {
      action: 'discount.create',
      module: 'marketing',
      entity: 'discount',
      entityId: created.id,
      entityLabel: created.code ?? created.name,
      newValues: created,
    });

    return ok(reply, serialise(created, await storeTimezone(store.db)), 201);
  });

  app.put('/discounts/:id', manage, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);
    const body = parseBody(discountInputSchema, request.body);

    const [existing] = await store.db.select().from(discounts).where(eq(discounts.id, id)).limit(1);
    if (!existing || existing.archivedAt) throw notFound('That discount does not exist.');

    await assertReferences(store.db, body);
    if (body.kind === 'voucher' && !body.code) body.code = existing.code ?? (await generateCode(store.db, 'V'));
    await assertCodeFree(store.db, body.code, id);

    const updated = await store.db.transaction(async (tx) => {
      const [row] = await tx
        .update(discounts)
        .set({ ...(await valuesFrom(tx, body)), updatedAt: new Date() })
        .where(eq(discounts.id, id))
        .returning();
      await syncCustomers(tx, id, body.customerIds);
      return row!;
    });

    await audit(store.db, request, {
      action: 'discount.update',
      module: 'marketing',
      entity: 'discount',
      entityId: id,
      entityLabel: updated.code ?? updated.name,
      oldValues: existing,
      newValues: updated,
    });

    return ok(reply, serialise(updated, await storeTimezone(store.db)));
  });

  app.patch('/discounts/:id/status', manage, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);
    const body = parseBody(statusBodySchema, request.body);

    const [updated] = await store.db
      .update(discounts)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(discounts.id, id), isNull(discounts.archivedAt)))
      .returning();
    if (!updated) throw notFound('That discount does not exist.');

    await audit(store.db, request, {
      action: `discount.${body.status === 'paused' ? 'pause' : body.status === 'active' ? 'activate' : 'draft'}`,
      module: 'marketing',
      entity: 'discount',
      entityId: id,
      entityLabel: updated.code ?? updated.name,
      newValues: { status: body.status },
    });

    return ok(reply, serialise(updated, await storeTimezone(store.db)));
  });

  /**
   * A copy to start from, saved as a draft so nothing goes live by accident. It
   * keeps the rules and the owner's named customers but none of the history —
   * uses, spent vouchers, rewards issued — because none of that happened to it.
   */
  app.post('/discounts/:id/duplicate', manage, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);

    const [source] = await store.db.select().from(discounts).where(eq(discounts.id, id)).limit(1);
    if (!source) throw notFound('That discount does not exist.');

    let code: string | null = null;
    if (source.code) {
      const base = `${source.code}-COPY`.slice(0, 40);
      const [taken] = await store.db
        .select({ id: discounts.id })
        .from(discounts)
        .where(eq(sql`upper(${discounts.code})`, base))
        .limit(1);
      code = taken ? await generateCode(store.db, source.code.slice(0, 12).replace(/[^A-Z0-9]/g, '')) : base;
    }

    const copy = await store.db.transaction(async (tx) => {
      const {
        id: _id,
        usedCount: _used,
        archivedAt: _archived,
        createdAt: _created,
        updatedAt: _updated,
        ...rest
      } = source;
      const [row] = await tx
        .insert(discounts)
        .values({ ...rest, name: `Copy of ${source.name}`.slice(0, 140), code, status: 'draft', usedCount: 0 })
        .returning();

      const named = await tx
        .select({ customerId: discountCustomers.customerId })
        .from(discountCustomers)
        .where(and(eq(discountCustomers.discountId, id), eq(discountCustomers.source, 'manual')));
      await syncCustomers(tx, row!.id, named.map((entry) => entry.customerId));
      return row!;
    });

    await audit(store.db, request, {
      action: 'discount.duplicate',
      module: 'marketing',
      entity: 'discount',
      entityId: copy.id,
      entityLabel: copy.code ?? copy.name,
      newValues: { from: id },
    });

    return ok(reply, serialise(copy, await storeTimezone(store.db)), 201);
  });

  /**
   * Deleting a discount that was ever used archives it instead.
   *
   * Orders and the redemption ledger point at it, and they are how a past
   * receipt's discount is explained; a voided use still counts, because the
   * order it belonged to still exists. An archived discount leaves the list,
   * refuses its code at the till, and keeps that code reserved.
   */
  app.delete('/discounts/:id', manage, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);

    const [existing] = await store.db
      .select({ id: discounts.id, name: discounts.name, code: discounts.code, archivedAt: discounts.archivedAt })
      .from(discounts)
      .where(eq(discounts.id, id))
      .limit(1);
    if (!existing || existing.archivedAt) throw notFound('That discount does not exist.');

    const [history] = await store.db
      .select({ total: count() })
      .from(discountRedemptions)
      .where(eq(discountRedemptions.discountId, id));

    if (Number(history?.total ?? 0) > 0) {
      await store.db
        .update(discounts)
        .set({ status: 'paused', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(discounts.id, id));

      await audit(store.db, request, {
        action: 'discount.archive',
        module: 'marketing',
        entity: 'discount',
        entityId: id,
        entityLabel: existing.code ?? existing.name,
      });

      return ok(reply, {
        deleted: false,
        archived: true,
        message: 'This discount has been used on orders, so it was archived rather than deleted. Its code stays reserved.',
      });
    }

    await store.db.delete(discounts).where(eq(discounts.id, id));

    await audit(store.db, request, {
      action: 'discount.delete',
      module: 'marketing',
      entity: 'discount',
      entityId: id,
      entityLabel: existing.code ?? existing.name,
    });

    return noContent(reply);
  });
}
