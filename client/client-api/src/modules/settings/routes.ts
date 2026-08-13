import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attributeValues,
  attributes,
  customers,
  orderItems,
  orders,
  paymentMethods,
  products,
  storeSettings,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { conflict, notFound } from '../../lib/errors';
import { noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { slugify } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';

const settingsSchema = z.object({
  storeName: z.string().trim().min(1, 'Give the store a name.').max(120),
  currency: z.string().trim().length(3, 'Use a three-letter code.').toUpperCase(),
  language: z.string().trim().min(2).max(8),
  timezone: z.string().trim().min(1).max(64),
  businessName: z.string().trim().max(160).nullable().default(null),
  businessEmail: z.string().trim().max(254).nullable().default(null),
  businessPhone: z.string().trim().max(24).nullable().default(null),
  businessAddress: z.string().trim().max(2000).nullable().default(null),
  seoTitle: z.string().trim().max(160).nullable().default(null),
  seoDescription: z.string().trim().max(300).nullable().default(null),
  whatsappNumber: z.string().trim().max(24).nullable().default(null),
  whatsappEnabled: z.boolean().default(false),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(5),
});

const attributeSchema = z.object({
  name: z.string().trim().min(1, 'Give the attribute a name.').max(80),
  slug: z.string().trim().max(90).optional(),
  inputType: z.enum(['select', 'color', 'text', 'number']).default('select'),
  isVariantAttribute: z.boolean().default(true),
  isFilterable: z.boolean().default(true),
  unit: z.string().trim().max(16).nullable().default(null),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  values: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        value: z.string().trim().min(1).max(120),
        colorHex: z.string().trim().max(9).nullable().default(null),
      }),
    )
    .max(200)
    .default([]),
});

const paymentSchema = z.object({
  provider: z.enum(['cod', 'mock', 'stripe', 'sslcommerz']),
  label: z.string().trim().min(1, 'Give it a name customers will recognise.').max(60),
  description: z.string().trim().max(200).nullable().default(null),
  instructions: z.string().trim().max(4000).nullable().default(null),
  isEnabled: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

/**
 * The store's own settings, its attribute vocabulary, and the numbers.
 *
 * Currency is here and it is the one field with teeth: prices are stored as
 * plain decimals with no currency of their own, so changing it re-labels every
 * existing price rather than converting it. The panel says so; this refuses to
 * do it silently once orders exist.
 */
export default async function settingsRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  // ------------------------------------------------------------ settings ----

  app.get(
    '/settings',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('settings.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const [row] = await store.db.select().from(storeSettings).limit(1);
      const preferences = row?.preferences ?? {};

      const [tally] = await store.db.select({ total: count() }).from(orders);

      return ok(reply, {
        storeName: row?.storeName ?? store.storeName,
        slug: store.slug,
        currency: row?.currency ?? store.currency,
        language: row?.language ?? store.language,
        timezone: row?.timezone ?? store.timezone,
        businessName: row?.businessName ?? null,
        businessEmail: row?.businessEmail ?? null,
        businessPhone: row?.businessPhone ?? null,
        businessAddress: row?.businessAddress ?? null,
        seoTitle: row?.seoTitle ?? null,
        seoDescription: row?.seoDescription ?? null,
        whatsappNumber: preferences.whatsappNumber ?? null,
        whatsappEnabled: preferences.whatsappEnabled === true,
        lowStockThreshold: preferences.lowStockThreshold ?? 5,
        /** Non-zero means changing currency is refused. */
        orderCount: Number(tally?.total ?? 0),
      });
    },
  );

  app.put(
    '/settings',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('settings.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(settingsSchema, request.body);

      const [existing] = await store.db.select().from(storeSettings).limit(1);
      if (!existing) throw notFound('This store has no settings row yet.');

      /*
       * Prices are decimals with no currency attached, so switching the code
       * would silently re-label every price and every past order's total. Once
       * a shop has taken money, that is a rewrite of its own books.
       */
      if (body.currency !== existing.currency) {
        const [tally] = await store.db.select({ total: count() }).from(orders);
        if (Number(tally?.total ?? 0) > 0) {
          throw conflict(
            'Currency cannot be changed once the store has taken orders — every existing price and total is recorded in the old one.',
          );
        }
      }

      const [updated] = await store.db
        .update(storeSettings)
        .set({
          storeName: body.storeName,
          currency: body.currency,
          language: body.language,
          timezone: body.timezone,
          businessName: body.businessName,
          businessEmail: body.businessEmail,
          businessPhone: body.businessPhone,
          businessAddress: body.businessAddress,
          seoTitle: body.seoTitle,
          seoDescription: body.seoDescription,
          preferences: {
            ...(existing.preferences ?? {}),
            whatsappNumber: body.whatsappNumber ?? undefined,
            whatsappEnabled: body.whatsappEnabled,
            lowStockThreshold: body.lowStockThreshold,
            // Kept in step so the storefront's selector logic stays honest.
            currencies: [body.currency],
            languages: [body.language],
          },
          updatedAt: new Date(),
        })
        .where(eq(storeSettings.id, existing.id))
        .returning();

      await audit(store.db, request, {
        action: 'settings.update',
        module: 'settings',
        entity: 'store_settings',
        entityId: existing.id,
        entityLabel: body.storeName,
        oldValues: { currency: existing.currency, storeName: existing.storeName },
        newValues: { currency: body.currency, storeName: body.storeName },
      });

      return ok(reply, updated);
    },
  );

  // ------------------------------------------------------ payment methods ----

  app.get(
    '/settings/payment-methods',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('settings.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const rows = await store.db
        .select({
          id: paymentMethods.id,
          provider: paymentMethods.provider,
          label: paymentMethods.label,
          description: paymentMethods.description,
          instructions: paymentMethods.instructions,
          isEnabled: paymentMethods.isEnabled,
          sortOrder: paymentMethods.sortOrder,
        })
        .from(paymentMethods)
        .orderBy(asc(paymentMethods.sortOrder));

      // `credentials_encrypted` is never selected. It is the one column on this
      // table that would matter if it leaked.
      return ok(reply, rows);
    },
  );

  app.put(
    '/settings/payment-methods',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('settings.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(paymentSchema, request.body);

      const [saved] = await store.db
        .insert(paymentMethods)
        .values(body)
        .onConflictDoUpdate({
          target: paymentMethods.provider,
          set: {
            label: body.label,
            description: body.description,
            instructions: body.instructions,
            isEnabled: body.isEnabled,
            sortOrder: body.sortOrder,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: paymentMethods.id,
          provider: paymentMethods.provider,
          label: paymentMethods.label,
          isEnabled: paymentMethods.isEnabled,
        });

      await audit(store.db, request, {
        action: 'settings.payment-method',
        module: 'settings',
        entity: 'payment_method',
        entityId: saved!.id,
        entityLabel: saved!.label,
        newValues: { provider: saved!.provider, isEnabled: saved!.isEnabled },
      });

      return ok(reply, saved);
    },
  );

  // ---------------------------------------------------------- attributes ----

  app.get(
    '/attributes',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('attributes.view')] },
    async (request, reply) => {
      const store = storeOf(request);

      const [rows, values] = await Promise.all([
        store.db.select().from(attributes).orderBy(asc(attributes.sortOrder), asc(attributes.name)),
        store.db.select().from(attributeValues).orderBy(asc(attributeValues.sortOrder)),
      ]);

      return ok(
        reply,
        rows.map((row) => ({
          ...row,
          values: values.filter((value) => value.attributeId === row.id),
        })),
      );
    },
  );

  app.post(
    '/attributes',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('attributes.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(attributeSchema, request.body);

      const created = await store.db.transaction(async (tx) => {
        const slug = slugify(body.slug ?? body.name);

        const [clash] = await tx
          .select({ id: attributes.id })
          .from(attributes)
          .where(eq(attributes.slug, slug))
          .limit(1);

        if (clash) throw conflict('An attribute with that name already exists.');

        const [row] = await tx
          .insert(attributes)
          .values({
            name: body.name,
            slug,
            inputType: body.inputType,
            isVariantAttribute: body.isVariantAttribute,
            isFilterable: body.isFilterable,
            unit: body.unit,
            sortOrder: body.sortOrder,
          })
          .returning();

        if (body.values.length > 0) {
          await tx.insert(attributeValues).values(
            body.values.map((value, index) => ({
              attributeId: row!.id,
              value: value.value,
              slug: slugify(value.value),
              colorHex: value.colorHex,
              sortOrder: index,
            })),
          );
        }

        return row!;
      });

      await audit(store.db, request, {
        action: 'attribute.create',
        module: 'settings',
        entity: 'attribute',
        entityId: created.id,
        entityLabel: created.name,
      });

      return ok(reply, created, 201);
    },
  );

  app.put(
    '/attributes/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('attributes.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(attributeSchema, request.body);

      const updated = await store.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(attributes).where(eq(attributes.id, id)).limit(1);
        if (!existing) throw notFound('That attribute does not exist.');

        const [row] = await tx
          .update(attributes)
          .set({
            name: body.name,
            inputType: body.inputType,
            isVariantAttribute: body.isVariantAttribute,
            isFilterable: body.isFilterable,
            unit: body.unit,
            sortOrder: body.sortOrder,
            updatedAt: new Date(),
          })
          .where(eq(attributes.id, id))
          .returning();

        /*
         * Values are merged, never replaced wholesale. A value that variants
         * already point at cannot be deleted by omission — dropping it would
         * cascade the variant links away and quietly unmake product options.
         */
        for (const [index, value] of body.values.entries()) {
          if (value.id) {
            await tx
              .update(attributeValues)
              .set({ value: value.value, colorHex: value.colorHex, sortOrder: index })
              .where(eq(attributeValues.id, value.id));
          } else {
            await tx
              .insert(attributeValues)
              .values({
                attributeId: id,
                value: value.value,
                slug: slugify(value.value),
                colorHex: value.colorHex,
                sortOrder: index,
              })
              .onConflictDoNothing();
          }
        }

        return row!;
      });

      return ok(reply, updated);
    },
  );

  app.delete(
    '/attributes/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('attributes.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [existing] = await store.db
        .select({ id: attributes.id, name: attributes.name })
        .from(attributes)
        .where(eq(attributes.id, id))
        .limit(1);

      if (!existing) throw notFound('That attribute does not exist.');

      const [inUse] = await store.db.execute<{ total: number }>(sql`
        select count(*)::int as total from product_variant_values pvv
        join attribute_values av on av.id = pvv.attribute_value_id
        where av.attribute_id = ${id}::uuid
      `).then((result) => result.rows ?? []);

      if (Number(inUse?.total ?? 0) > 0) {
        throw conflict('Products are using this attribute. Remove it from them first.');
      }

      await store.db.delete(attributes).where(eq(attributes.id, id));

      await audit(store.db, request, {
        action: 'attribute.delete',
        module: 'settings',
        entity: 'attribute',
        entityId: id,
        entityLabel: existing.name,
      });

      return noContent(reply);
    },
  );

  // --------------------------------------------------------------- reports ---

  /**
   * The numbers, computed from orders rather than read from a rollup.
   *
   * `store_daily_metrics` exists but nothing maintains it yet, and a figure that
   * is quietly stale is worse than one that costs a query. A shop with enough
   * orders for this to hurt has outgrown the assumption, and that is the point
   * at which the rollup should start being written.
   */
  app.get(
    '/reports',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('reports.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(
        z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
        request.query,
      );

      const since = new Date();
      since.setDate(since.getDate() - query.days);

      const counted = sql`${orders.status} not in ('cancelled', 'failed')`;

      const [totals, daily, topProducts, newCustomers] = await Promise.all([
        store.db
          .select({
            orders: count(),
            revenue: sql<string>`coalesce(sum(${orders.grandTotal}), 0)::text`,
            discounts: sql<string>`coalesce(sum(${orders.discountTotal}), 0)::text`,
            refunded: sql<string>`coalesce(sum(${orders.refundedTotal}), 0)::text`,
          })
          .from(orders)
          .where(and(gte(orders.placedAt, since), counted)),

        store.db
          .select({
            day: sql<string>`to_char(${orders.placedAt}, 'YYYY-MM-DD')`,
            orders: count(),
            revenue: sql<string>`coalesce(sum(${orders.grandTotal}), 0)::text`,
          })
          .from(orders)
          .where(and(gte(orders.placedAt, since), counted))
          .groupBy(sql`to_char(${orders.placedAt}, 'YYYY-MM-DD')`)
          .orderBy(sql`to_char(${orders.placedAt}, 'YYYY-MM-DD')`),

        store.db
          .select({
            productId: orderItems.productId,
            name: orderItems.productName,
            units: sql<number>`sum(${orderItems.quantity})::int`,
            revenue: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)::text`,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .where(and(gte(orders.placedAt, since), counted))
          .groupBy(orderItems.productId, orderItems.productName)
          .orderBy(desc(sql`sum(${orderItems.quantity})`))
          .limit(10),

        store.db
          .select({ total: count() })
          .from(customers)
          .where(gte(customers.createdAt, since)),
      ]);

      const [catalogue] = await store.db
        .select({ total: count() })
        .from(products)
        .where(eq(products.status, 'active'));

      const revenue = Number(totals[0]?.revenue ?? 0);
      const orderCount = Number(totals[0]?.orders ?? 0);

      return ok(reply, {
        days: query.days,
        currency: store.currency,
        totals: {
          orders: orderCount,
          revenue: totals[0]?.revenue ?? '0',
          discounts: totals[0]?.discounts ?? '0',
          refunded: totals[0]?.refunded ?? '0',
          averageOrderValue: orderCount > 0 ? (revenue / orderCount).toFixed(2) : '0.00',
          newCustomers: Number(newCustomers[0]?.total ?? 0),
          activeProducts: Number(catalogue?.total ?? 0),
        },
        daily: daily.map((row) => ({ ...row, orders: Number(row.orders) })),
        topProducts: topProducts.map((row) => ({ ...row, units: Number(row.units) })),
      });
    },
  );
}
