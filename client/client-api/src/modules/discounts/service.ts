import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  brands,
  categories,
  collectionProducts,
  customers,
  discountCustomers,
  discountRedemptions,
  discounts,
  orders,
  paymentBanks,
  products,
  storeSettings,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import {
  evaluateDiscounts,
  type EngineBank,
  type EngineContext,
  type EngineDiscount,
  type EngineHolding,
  type EngineLine,
  type EngineQuote,
  type EngineUsage,
} from '../../lib/discounts/engine';
import {
  DEFAULT_DISCOUNT_STRATEGY,
  DISCOUNT_STRATEGIES,
  areaRulesSchema,
  combinationRulesSchema,
  customerRulesSchema,
  paymentRulesSchema,
  productRulesSchema,
  purchaseRulesSchema,
  readRules,
  rewardRulesSchema,
  scheduleRulesSchema,
  PROVIDER_CHANNELS,
  type DiscountStrategy,
  type PaymentChannelChoice,
} from '../../lib/discounts/rules';
import { isValidTimeZone } from '../../lib/discounts/zoned-time';
import { ERROR_CODES, unprocessable } from '../../lib/errors';
import { loadStoreCurrency } from '../../lib/store-currency';
import { moneyToNumber } from '../../lib/utils';
import type { StoreContext } from '../../plugins/tenant';
import type { PricedLine } from '../storefront/checkout.service';

/**
 * Everything the discount engine needs that lives in the database.
 *
 * `lib/discounts/engine.ts` decides; this file only gathers. Every query here is
 * bounded by the basket in hand or by the handful of discounts it could touch —
 * nothing scans a store's order history — because the basket asks this on every
 * change and checkout asks it inside the order transaction.
 */

/** Codes a basket may carry at once. A limit, not a feature: nobody needs six. */
export const MAX_CODES = 5;

type DiscountRow = typeof discounts.$inferSelect;

// ---------------------------------------------------------------- money --

export const toCents = (value: string | number | null | undefined): number => Math.round(moneyToNumber(value) * 100);
export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/**
 * How a refusal sentence prints money: the currency's narrow symbol, and no
 * decimals on a round figure — "Minimum order amount is ৳1,000." rather than
 * "BDT 1,000.00", which is how a till would say it and not how a shop does.
 */
export function moneyFormatter(currency: string): (cents: number) => string {
  const format = (cents: number, fraction: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    }).format(cents / 100);

  return (cents) => {
    try {
      return format(cents, cents % 100 === 0 ? 0 : 2);
    } catch {
      return `${currency} ${(cents / 100).toFixed(2)}`;
    }
  };
}

// ------------------------------------------------------------- settings --

export interface DiscountSettings {
  timezone: string;
  strategy: DiscountStrategy;
  currency: string;
}

/** The store's clock, its stacking strategy and its currency — read together, because every quote needs all three. */
export async function loadDiscountSettings(store: StoreContext): Promise<DiscountSettings> {
  const [row] = await store.db
    .select({ timezone: storeSettings.timezone, preferences: storeSettings.preferences })
    .from(storeSettings)
    .limit(1);

  const strategy = row?.preferences?.discountStrategy;
  const timezone = row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : 'UTC';

  return {
    timezone,
    strategy: strategy && DISCOUNT_STRATEGIES.includes(strategy) ? strategy : DEFAULT_DISCOUNT_STRATEGY,
    currency: await loadStoreCurrency(store),
  };
}

/** A stored row, parsed into what the engine reads. */
export function toEngineDiscount(row: DiscountRow, storeTimezone: string): EngineDiscount {
  const valueNumber = moneyToNumber(row.value);
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    title: row.title,
    summary: row.summary,
    status: row.status,
    archived: row.archivedAt !== null,
    valueType: row.valueType,
    value: row.valueType === 'percentage' ? valueNumber : toCents(row.value),
    maxDiscountCents: row.maxDiscountAmount === null ? null : toCents(row.maxDiscountAmount),
    minOrderCents: row.minOrderAmount === null ? null : toCents(row.minOrderAmount),
    minQuantity: row.minQuantity,
    maxDiscountedQuantity: row.maxDiscountedQuantity,
    minSubtotalAfterCents: row.minSubtotalAfterDiscount === null ? null : toCents(row.minSubtotalAfterDiscount),
    productRules: readRules(productRulesSchema, row.productRules),
    purchaseRules: readRules(purchaseRulesSchema, row.purchaseRules),
    rewardRules: readRules(rewardRulesSchema, row.rewardRules),
    customerRules: readRules(customerRulesSchema, row.customerRules),
    paymentRules: readRules(paymentRulesSchema, row.paymentRules),
    areaRules: readRules(areaRulesSchema, row.areaRules),
    scheduleRules: readRules(scheduleRulesSchema, row.scheduleRules),
    combinationRules: readRules(combinationRulesSchema, row.combinationRules),
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    perCustomerLimit: row.perCustomerLimit,
    cooldown:
      row.cooldownAmount !== null && row.cooldownUnit !== null
        ? { amount: row.cooldownAmount, unit: row.cooldownUnit }
        : null,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timezone: row.timezone && isValidTimeZone(row.timezone) ? row.timezone : storeTimezone,
    priority: row.priority,
    createdAt: row.createdAt,
  };
}

export function normaliseCodes(codes: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      codes
        .map((code) => (code ?? '').trim().toUpperCase())
        .filter((code) => code.length > 0 && code.length <= 40),
    ),
  ].slice(0, MAX_CODES);
}

/** Digits only, last ten — `+8801700000000` and `01700000000` are one handset. */
function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-10) : null;
}

/**
 * What the shopper is paying with, as far as the provider allows.
 *
 * Cash on delivery can only be cash, so it is never asked. For a provider that
 * takes more than one instrument the shopper's word is taken — and refused if
 * the provider cannot take it at all — because it is what a bank or wallet offer
 * was granted against, and a real gateway's report of what was actually charged
 * is what an adapter checks it against (`orders.payment_channel`, `card_bin`).
 */
export function resolveChannel(provider: string, requested: PaymentChannelChoice | null): PaymentChannelChoice | null {
  const allowed = PROVIDER_CHANNELS[provider] ?? [];
  if (allowed.length === 1) return allowed[0]!;
  if (!requested) return null;
  if (!allowed.includes(requested)) {
    throw unprocessable('That payment method cannot be used with this payment option.', ERROR_CODES.VALIDATION_FAILED, {
      paymentChannel: ['Choose how you will pay.'],
    });
  }
  return requested;
}

// ---------------------------------------------------------------- quote --

export interface QuoteRequest {
  lines: PricedLine[];
  codes: string[];
  address: { country: string | null; city: string | null } | null;
  customerId: string | null;
  /** Extra contact details this order carries, for the identity-linked limits. */
  contact?: { email?: string | null; phone?: string | null };
  payment: { channel: PaymentChannelChoice | null; cardBin: string | null };
}

export interface DiscountQuote extends EngineQuote {
  currency: string;
  subtotalCents: number;
}

export async function quoteDiscounts(
  db: TenantExecutor,
  settings: DiscountSettings,
  request: QuoteRequest,
): Promise<DiscountQuote> {
  const now = new Date();
  const codes = normaliseCodes(request.codes);
  const money = moneyFormatter(settings.currency);

  const liveAutomatic = and(
    isNull(discounts.code),
    eq(discounts.status, 'active'),
    sql`(${discounts.startsAt} is null or ${discounts.startsAt} <= now())`,
    sql`(${discounts.endsAt} is null or ${discounts.endsAt} > now())`,
    sql`(${discounts.usageLimit} is null or ${discounts.usedCount} < ${discounts.usageLimit})`,
  );

  const rows = await db
    .select()
    .from(discounts)
    .where(
      and(
        isNull(discounts.archivedAt),
        codes.length > 0 ? or(inArray(sql`upper(${discounts.code})`, codes), liveAutomatic) : liveAutomatic,
      ),
    );

  const candidates = rows.map((row) => toEngineDiscount(row, settings.timezone));
  const byCode = new Map(candidates.filter((d) => d.code).map((d) => [d.code!.toUpperCase(), d]));
  const candidateIds = candidates.map((d) => d.id);

  // --- the basket, described the way rules are written -------------------------------
  const productIds = [...new Set(request.lines.map((line) => line.productId))];
  const [productRows, categoryRows, collectionRows] = await Promise.all([
    productIds.length
      ? db
          .select({ id: products.id, categoryId: products.categoryId, brandId: products.brandId })
          .from(products)
          .where(inArray(products.id, productIds))
      : Promise.resolve([]),
    db.select({ id: categories.id, parentId: categories.parentId, name: categories.name }).from(categories),
    productIds.length
      ? db
          .select({ productId: collectionProducts.productId, collectionId: collectionProducts.collectionId })
          .from(collectionProducts)
          .where(inArray(collectionProducts.productId, productIds))
      : Promise.resolve([]),
  ]);

  const parentOf = new Map(categoryRows.map((row) => [row.id, row.parentId]));
  const lineage = (categoryId: string | null): string[] => {
    const chain: string[] = [];
    let current = categoryId;
    // `parent_id` carries no foreign key, so a cycle is possible and is cut off.
    while (current && !chain.includes(current) && chain.length < 20) {
      chain.push(current);
      current = parentOf.get(current) ?? null;
    }
    return chain;
  };
  const productById = new Map(productRows.map((row) => [row.id, row]));
  const collectionsOf = new Map<string, string[]>();
  for (const row of collectionRows) {
    collectionsOf.set(row.productId, [...(collectionsOf.get(row.productId) ?? []), row.collectionId]);
  }

  const lines: EngineLine[] = request.lines.map((line, index) => {
    const product = productById.get(line.productId);
    return {
      key: String(index),
      productId: line.productId,
      variantId: line.variantId,
      productName: line.productName,
      categoryIds: lineage(product?.categoryId ?? null),
      brandId: product?.brandId ?? null,
      collectionIds: collectionsOf.get(line.productId) ?? [],
      quantity: line.quantity,
      unitCents: toCents(line.unitSalePrice ?? line.unitPrice),
      onSale: line.unitSalePrice !== null,
      lineCents: toCents(line.lineTotal),
    };
  });

  // --- who is asking ----------------------------------------------------------------
  let customer: EngineContext['customer'] = null;
  const usage = new Map<string, EngineUsage>();
  const holdings = new Map<string, EngineHolding[]>();
  const listedFor = new Set<string>();

  if (request.customerId && candidateIds.length > 0) {
    const [profile] = await db
      .select({
        id: customers.id,
        createdAt: customers.createdAt,
        birthDate: customers.birthDate,
        customerType: customers.customerType,
        email: customers.email,
        phone: customers.phone,
        phoneE164: customers.phoneE164,
      })
      .from(customers)
      .where(eq(customers.id, request.customerId))
      .limit(1);

    if (profile) {
      const [history] = await db
        .select({
          previous: sql<number>`count(*) filter (where ${orders.status} not in ('cancelled', 'failed'))::int`,
          lastOrderAt: sql<Date | null>`max(${orders.placedAt}) filter (where ${orders.status} not in ('cancelled', 'failed'))`,
        })
        .from(orders)
        .where(eq(orders.customerId, profile.id));

      customer = {
        id: profile.id,
        createdAt: profile.createdAt,
        birthDate: profile.birthDate,
        customerType: profile.customerType,
        previousOrders: Number(history?.previous ?? 0),
        lastOrderAt: history?.lastOrderAt ? new Date(history.lastOrderAt) : null,
      };

      const emails = [...new Set([profile.email, request.contact?.email].filter(Boolean).map((v) => v!.toLowerCase()))];
      const phones = [
        ...new Set(
          [profile.phoneE164, profile.phone, request.contact?.phone].map(phoneKey).filter((v): v is string => Boolean(v)),
        ),
      ];

      const counted = candidates.filter((d) => d.perCustomerLimit !== null || d.cooldown !== null);
      if (counted.length > 0) {
        /*
         * Two counts per discount: this account's own uses, and the uses of every
         * account sharing its email or phone. Which one a discount is held to is
         * its own `limitByIdentity` — one query answers both.
         */
        const linked: SQL[] = [sql`${discountRedemptions.customerId} = ${profile.id}`];
        if (emails.length) linked.push(inArray(sql`lower(${orders.email})`, emails));
        if (phones.length) {
          linked.push(inArray(sql`right(regexp_replace(coalesce(${orders.phone}, ''), '\\D', '', 'g'), 10)`, phones));
        }

        const tallies = await db
          .select({
            discountId: discountRedemptions.discountId,
            ownUses: sql<number>`count(*) filter (where ${discountRedemptions.customerId} = ${profile.id})::int`,
            ownLast: sql<Date | null>`max(${discountRedemptions.createdAt}) filter (where ${discountRedemptions.customerId} = ${profile.id})`,
            linkedUses: sql<number>`count(*)::int`,
            linkedLast: sql<Date | null>`max(${discountRedemptions.createdAt})`,
          })
          .from(discountRedemptions)
          .innerJoin(orders, eq(orders.id, discountRedemptions.orderId))
          .where(
            and(
              isNull(discountRedemptions.voidedAt),
              inArray(
                discountRedemptions.discountId,
                counted.map((d) => d.id),
              ),
              or(...linked),
            ),
          )
          .groupBy(discountRedemptions.discountId);

        for (const tally of tallies) {
          const discount = counted.find((d) => d.id === tally.discountId);
          const byIdentity = discount?.customerRules.limitByIdentity ?? false;
          const last = byIdentity ? tally.linkedLast : tally.ownLast;
          usage.set(tally.discountId, {
            uses: Number(byIdentity ? tally.linkedUses : tally.ownUses),
            lastUsedAt: last ? new Date(last) : null,
          });
        }
      }

      const assigned = await db
        .select({
          id: discountCustomers.id,
          discountId: discountCustomers.discountId,
          expiresAt: discountCustomers.expiresAt,
          usedAt: discountCustomers.usedAt,
        })
        .from(discountCustomers)
        .where(and(eq(discountCustomers.customerId, profile.id), inArray(discountCustomers.discountId, candidateIds)));

      for (const row of assigned) {
        listedFor.add(row.discountId);
        holdings.set(row.discountId, [
          ...(holdings.get(row.discountId) ?? []),
          { id: row.id, expiresAt: row.expiresAt, usedAt: row.usedAt },
        ]);
      }
    }
  }

  // --- banks and names ----------------------------------------------------------------
  const needsBanks = candidates.some(
    (d) =>
      d.paymentRules.bankIds.length > 0 ||
      d.paymentRules.channels.some((channel) => channel === 'credit_card' || channel === 'debit_card'),
  );
  const bankRows = needsBanks
    ? await db
        .select({ id: paymentBanks.id, name: paymentBanks.name, prefixes: paymentBanks.cardPrefixes })
        .from(paymentBanks)
        .where(eq(paymentBanks.isActive, true))
    : [];
  const banks = new Map<string, EngineBank>(
    bankRows.map((row) => [row.id, { id: row.id, name: row.name, prefixes: row.prefixes ?? [] }]),
  );

  const named = new Set<string>();
  for (const d of candidates) {
    for (const id of [
      ...d.purchaseRules.requiredProductIds,
      ...d.purchaseRules.requiredCategoryIds,
      ...d.purchaseRules.requiredBrandIds,
      ...d.rewardRules.getProductIds,
      ...d.rewardRules.getCategoryIds,
      ...(d.valueType === 'bundle' ? d.productRules.productIds : []),
    ]) {
      named.add(id);
    }
  }
  const names = new Map<string, string>(categoryRows.map((row) => [row.id, row.name]));
  if (named.size > 0) {
    const wanted = [...named];
    const [productNames, brandNames] = await Promise.all([
      db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, wanted)),
      db.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.id, wanted)),
    ]);
    for (const row of [...productNames, ...brandNames]) names.set(row.id, row.name);
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);

  const quote = evaluateDiscounts(
    {
      now,
      timezone: settings.timezone,
      lines,
      address: request.address,
      customer,
      listedFor,
      holdings,
      usage,
      payment: request.payment,
      banks,
      names,
      money,
      strategy: settings.strategy,
    },
    {
      entered: codes.map((code) => ({ code, discount: byCode.get(code) ?? null })),
      automatic: candidates.filter((d) => !d.code),
    },
  );

  return { ...quote, currency: settings.currency, subtotalCents };
}

// ----------------------------------------------------------- redemption --

/**
 * Serialises one customer's checkouts against each other.
 *
 * Per-customer limits, cooldowns and voucher holdings are all read and then
 * written inside the order transaction; two tabs placing orders at the same
 * instant would both read "unused". A transaction-scoped advisory lock on the
 * customer makes the second wait for the first to commit, and costs nothing to
 * anybody else's checkout.
 */
export async function lockCustomerDiscounts(tx: TenantExecutor, customerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`discounts:${customerId}`}, 0))`);
}

/**
 * Records every applied discount against a placed order.
 *
 * The usage limit is claimed by a **conditional** increment, so the last use of
 * a limited code goes to exactly one of two orders racing for it, and the loser
 * is told in words rather than handed a total the shop never agreed to.
 */
export async function redeemDiscounts(
  tx: TenantExecutor,
  input: {
    orderId: string;
    customerId: string;
    quote: EngineQuote;
    originalCents: number;
    finalCents: number;
  },
): Promise<void> {
  const now = new Date();

  for (const applied of input.quote.applied) {
    const [claimed] = await tx
      .update(discounts)
      .set({ usedCount: sql`${discounts.usedCount} + 1`, updatedAt: now })
      .where(
        and(
          eq(discounts.id, applied.id),
          sql`(${discounts.usageLimit} is null or ${discounts.usedCount} < ${discounts.usageLimit})`,
        ),
      )
      .returning({ id: discounts.id });

    if (!claimed) {
      const name = applied.code ?? applied.label;
      throw unprocessable(
        `${name} has just been fully claimed. Your order was not placed — please review your basket.`,
        ERROR_CODES.DISCOUNT_LIMIT_REACHED,
        { couponCodes: [`${name} has been fully claimed.`] },
      );
    }

    if (applied.holdingId) {
      const [spent] = await tx
        .update(discountCustomers)
        .set({ usedAt: now, orderId: input.orderId })
        .where(and(eq(discountCustomers.id, applied.holdingId), isNull(discountCustomers.usedAt)))
        .returning({ id: discountCustomers.id });

      if (!spent) {
        throw unprocessable('This voucher has already been used.', ERROR_CODES.DISCOUNT_NOT_APPLICABLE, {
          couponCodes: ['This voucher has already been used.'],
        });
      }
    }

    await tx.insert(discountRedemptions).values({
      discountId: applied.id,
      orderId: input.orderId,
      customerId: input.customerId,
      code: applied.code,
      discountAmount: fromCents(applied.totalCents),
      originalAmount: fromCents(input.originalCents),
      finalAmount: fromCents(input.finalCents),
      assignmentId: applied.holdingId,
    });
  }
}

/**
 * Hands back every use a cancelled order made.
 *
 * Called wherever an order becomes `cancelled` or `failed`. An order that never
 * happened must not count against a code's limit, a customer's allowance or
 * their cooldown — and a voucher it spent goes back into their account.
 * Idempotent: a redemption already voided is not voided twice, so a
 * cancel-then-fail cannot decrement a counter below what was used.
 */
export async function voidOrderDiscounts(tx: TenantExecutor, orderId: string): Promise<number> {
  const voided = await tx
    .update(discountRedemptions)
    .set({ voidedAt: new Date() })
    .where(and(eq(discountRedemptions.orderId, orderId), isNull(discountRedemptions.voidedAt)))
    .returning({ discountId: discountRedemptions.discountId, assignmentId: discountRedemptions.assignmentId });

  for (const row of voided) {
    await tx
      .update(discounts)
      .set({ usedCount: sql`greatest(${discounts.usedCount} - 1, 0)`, updatedAt: new Date() })
      .where(eq(discounts.id, row.discountId));
  }

  const assignments = voided.map((row) => row.assignmentId).filter((id): id is string => Boolean(id));
  if (assignments.length > 0) {
    await tx
      .update(discountCustomers)
      .set({ usedAt: null, orderId: null })
      .where(inArray(discountCustomers.id, assignments));
  }

  return voided.length;
}

/** The JSON a storefront basket or checkout is given. Cents stay on this side of the API. */
export function quoteView(quote: DiscountQuote, lines: PricedLine[]) {
  return {
    currency: quote.currency,
    subtotal: fromCents(quote.subtotalCents),
    itemDiscount: fromCents(quote.itemCents),
    discountTotal: fromCents(quote.totalCents),
    applied: quote.applied.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      code: entry.code,
      label: entry.label,
      summary: entry.summary,
      valueType: entry.valueType,
      automatic: entry.automatic,
      amount: fromCents(entry.totalCents),
      itemAmount: fromCents(entry.itemCents),
      message: entry.message,
    })),
    refused: quote.refused.map(({ code, label, reason, message, retainable }) => ({ code, label, reason, message, retainable })),
    hints: quote.hints.map(({ label, reason, message }) => ({ label, reason, message })),
    lines: lines.map((line, index) => ({
      productId: line.productId,
      variantId: line.variantId,
      measure: line.measure,
      discount: fromCents(quote.lineCents[String(index)] ?? 0),
    })),
  };
}
