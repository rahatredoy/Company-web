import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { attributeValues, attributes, orders, paymentMethods, storeSettings } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { isSupportedCurrency } from '../../lib/currencies';
import { isSupportedLanguage, resolveLanguage } from '../../lib/languages';
import { forgetStoreLocale } from '../../lib/store-currency';
import { noContent, ok, parseBody, parseParams, uuidParamSchema } from '../../lib/http';
import {
  DEFAULT_MEASURE_OPTIONS,
  MAX_MEASURE_OPTIONS,
  measureOptionSchema,
  normaliseMeasureOptions,
} from '../../lib/measure';
import { slugify } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';

const settingsSchema = z.object({
  storeName: z.string().trim().min(1, 'Give the store a name.').max(120),
  currency: z.string().trim().length(3, 'Choose a currency.').toUpperCase(),
  /**
   * Required to be true when the currency moves on a store that has taken
   * orders — see the handler. Absent is false, so an older client that has
   * never heard of it is refused rather than allowed to re-label a trading shop.
   */
  confirmCurrencyChange: z.boolean().default(false),
  /**
   * One of `lib/languages.ts` — checked in the handler, and only when it moves,
   * for the reason the currency is: a store provisioned with a regional code
   * such as `en-US` must still be able to save its phone number.
   */
  language: z.string().trim().min(2).max(8),
  timezone: z.string().trim().min(1).max(64),
  businessName: z.string().trim().max(160).nullable().default(null),
  businessEmail: z.string().trim().max(254).nullable().default(null),
  businessPhone: z.string().trim().max(24).nullable().default(null),
  businessAddress: z.string().trim().max(2000).nullable().default(null),
  /*
   * Omitted means unchanged: the panel's Settings screen no longer asks for
   * these, and a save that leaves them out must not blank the storefront's
   * title. Drizzle skips an `undefined` in `.set()`, so the column is untouched.
   */
  seoTitle: z.string().trim().max(160).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  whatsappNumber: z.string().trim().max(24).nullable().default(null),
  whatsappEnabled: z.boolean().default(false),
  /**
   * Omitted means unchanged. The panel's Settings screen no longer asks for it —
   * each product sets its own alert when it is added — and nothing else reads
   * this store-wide copy, so a save that leaves it out must not reset it to 5.
   */
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).optional(),
  /**
   * The shop's default picker for products sold by weight or volume.
   *
   * A product may still name its own list; an empty one here just means every
   * measure product falls back to the platform default (1kg/500gm/250gm/100gm).
   *
   * **Omitted means unchanged**, not empty. The panel's Settings screen no
   * longer edits this list — sizes are picked on each product — so a save from
   * it carries no `measureOptions`, and defaulting that to `[]` would silently
   * reset the shop's list on every change of store name or phone number.
   */
  measureOptions: z.array(measureOptionSchema).max(MAX_MEASURE_OPTIONS).optional(),
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

const reorderSchema = z.object({
  order: z
    .array(z.object({ id: z.string().uuid(), sortOrder: z.number().int().min(0).max(100_000) }))
    .min(1, 'Nothing to reorder.')
    .max(500),
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
 * The store's own settings, its payment methods and its attribute vocabulary.
 *
 * Currency is here and it is the one field with teeth: prices are stored as
 * plain decimals with no currency of their own, so changing it re-labels every
 * catalogue price rather than converting it — ৳40 becomes $40. That is exactly
 * right for a shop whose prices were always meant in the new currency, and
 * wrong for one that was genuinely trading in the old, so once orders exist the
 * change is taken only with `confirmCurrencyChange`, which the panel sends after
 * showing the owner what it will and will not do.
 *
 * What it never does is touch an order. `orders.currency` is snapshotted at
 * checkout, so every order already taken keeps the currency it was charged in,
 * and every money total the panel shows adds up orders in the current currency
 * only — a sum of dollars and taka printed with one symbol is not a figure.
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

      const byCurrency = await store.db
        .select({ currency: orders.currency, orders: count() })
        .from(orders)
        .groupBy(orders.currency)
        .orderBy(desc(count()));

      return ok(reply, {
        storeName: row?.storeName ?? store.storeName,
        slug: store.slug,
        currency: row?.currency ?? store.currency,
        // Resolved, so the picker always has an entry selected: a stored `en-US`
        // is shown as English, which is what the whole panel is drawn in.
        language: resolveLanguage(row?.language ?? store.language),
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
        measureOptions: normaliseMeasureOptions(preferences.measureOptions ?? []),
        /** What a product falls back to when neither it nor the shop names a list. */
        defaultMeasureOptions: DEFAULT_MEASURE_OPTIONS,
        /** Non-zero means changing currency has to be confirmed. */
        orderCount: byCurrency.reduce((total, row) => total + Number(row.orders), 0),
        /**
         * How many orders were taken in each currency, most first. More than one
         * entry means the store has switched before, and the panel says which
         * orders its totals are leaving out.
         */
        orderCurrencies: byCurrency.map((row) => ({ currency: row.currency, orders: Number(row.orders) })),
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

      const currencyChanged = body.currency !== existing.currency;
      const languageChanged = body.language !== existing.language;

      if (languageChanged && !isSupportedLanguage(body.language)) {
        throw unprocessable('Choose a language from the list.', ERROR_CODES.VALIDATION_FAILED, {
          language: ['Choose a language from the list.'],
        });
      }

      /*
       * Checked only when it moves. A store provisioned with a code that has
       * since left circulation must still be able to save its other settings
       * without being made to pick a new currency first.
       */
      if (currencyChanged && !isSupportedCurrency(body.currency)) {
        throw unprocessable('Choose a currency from the list.', ERROR_CODES.UNSUPPORTED_CURRENCY, {
          currency: ['Choose a currency from the list.'],
        });
      }

      /*
       * Prices are decimals with no currency attached, so switching the code
       * re-labels every price in the catalogue rather than converting it. On a
       * shop with no orders that is simply setting it up; on one that has
       * taken money it is a decision about its own prices, and it is refused
       * until the request says the owner was shown that. Past orders are safe
       * either way — they carry their own `currency`.
       */
      if (currencyChanged && !body.confirmCurrencyChange) {
        const [tally] = await store.db.select({ total: count() }).from(orders);
        if (Number(tally?.total ?? 0) > 0) {
          throw conflict(
            `This store has taken orders in ${existing.currency}. Switching to ${body.currency} does not convert prices — every price keeps its number and changes its symbol — so it has to be confirmed.`,
            ERROR_CODES.CURRENCY_CHANGE_UNCONFIRMED,
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
            lowStockThreshold: body.lowStockThreshold ?? existing.preferences?.lowStockThreshold,
            measureOptions:
              body.measureOptions === undefined
                ? existing.preferences?.measureOptions
                : normaliseMeasureOptions(body.measureOptions),
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
        oldValues: { currency: existing.currency, language: existing.language, storeName: existing.storeName },
        newValues: { currency: body.currency, language: body.language, storeName: body.storeName },
      });

      // Before the reply, not in the `onResponse` hook: see `forgetStoreLocale`.
      if (currencyChanged || languageChanged) await forgetStoreLocale(store.tenantRef);

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

      /*
       * How many products each value is attached to, both ways round: a variant
       * value (`product_variant_values` — picking it buys a different thing) and a
       * descriptive one (`product_attribute_values` — it only narrows a listing).
       * The panel needs this to say whether a value can still be deleted, and
       * counting it here is one query rather than one per row on screen.
       */
      const [rows, values, usage] = await Promise.all([
        store.db.select().from(attributes).orderBy(asc(attributes.sortOrder), asc(attributes.name)),
        store.db.select().from(attributeValues).orderBy(asc(attributeValues.sortOrder)),
        store.db
          .execute<{ attribute_value_id: string; variants: number; products: number }>(sql`
            select av.id as attribute_value_id,
                   count(distinct pvv.variant_id)::int as variants,
                   count(distinct coalesce(v.product_id, pav.product_id))::int as products
              from ${attributeValues} av
              left join product_variant_values pvv on pvv.attribute_value_id = av.id
              left join product_variants v on v.id = pvv.variant_id
              left join product_attribute_values pav on pav.attribute_value_id = av.id
             group by av.id
          `)
          .then((result) => result.rows ?? []),
      ]);

      const usageOf = new Map(usage.map((row) => [row.attribute_value_id, row]));

      return ok(
        reply,
        rows.map((row) => {
          const own = values
            .filter((value) => value.attributeId === row.id)
            .map((value) => {
              const counted = usageOf.get(value.id);
              return {
                ...value,
                variantCount: Number(counted?.variants ?? 0),
                productCount: Number(counted?.products ?? 0),
              };
            });

          return {
            ...row,
            values: own,
            /** Products reached through any of this attribute's values. */
            productCount: own.reduce((sum, value) => sum + value.productCount, 0),
            variantCount: own.reduce((sum, value) => sum + value.variantCount, 0),
          };
        }),
      );
    },
  );

  /**
   * The whole list's order in one statement. `sort_order` is what the storefront
   * lists its filters by, so a half-applied reorder is visible to shoppers.
   *
   * Registered before `/attributes/:id` for legibility only; find-my-way matches
   * the static segment ahead of the parametric one regardless.
   */
  app.patch(
    '/attributes/reorder',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('attributes.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { order } = parseBody(reorderSchema, request.body);

      const ids = order.map((entry) => entry.id);
      const cases = sql.join(
        order.map((entry) => sql`when ${attributes.id} = ${entry.id}::uuid then ${entry.sortOrder}`),
        sql` `,
      );

      await store.db
        .update(attributes)
        .set({ sortOrder: sql`case ${cases} else ${attributes.sortOrder} end`, updatedAt: new Date() })
        .where(inArray(attributes.id, ids));

      await audit(store.db, request, {
        action: 'attribute.reorder',
        module: 'settings',
        entity: 'attribute',
        entityId: ids[0]!,
        entityLabel: `${ids.length} attribute${ids.length === 1 ? '' : 's'}`,
        newValues: { order },
      });

      return noContent(reply);
    },
  );

  /**
   * Deleting one value.
   *
   * `PUT /attributes/:id` deliberately **merges** its value list rather than
   * replacing it, so a value cannot be removed by leaving it out — omission is
   * indistinguishable from a form that failed to load, and the cascade would
   * quietly unmake every variant built on it. Removing one is therefore its own
   * request, and it is refused while anything still points at it.
   */
  app.delete(
    '/attributes/:id/values/:valueId',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('attributes.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id, valueId } = parseParams(
        z.object({ id: z.string().uuid('Invalid identifier.'), valueId: z.string().uuid('Invalid identifier.') }),
        request.params,
      );

      const [value] = await store.db
        .select({ id: attributeValues.id, value: attributeValues.value })
        .from(attributeValues)
        .where(and(eq(attributeValues.id, valueId), eq(attributeValues.attributeId, id)))
        .limit(1);

      if (!value) throw notFound('That value does not exist.');

      const [inUse] = await store.db
        .execute<{ total: number }>(
          sql`
            select (
              (select count(*) from product_variant_values where attribute_value_id = ${valueId}::uuid)
              +
              (select count(*) from product_attribute_values where attribute_value_id = ${valueId}::uuid)
            )::int as total
          `,
        )
        .then((result) => result.rows ?? []);

      if (Number(inUse?.total ?? 0) > 0) {
        throw conflict('Products are using this value. Remove it from them first.');
      }

      await store.db.delete(attributeValues).where(eq(attributeValues.id, valueId));

      await audit(store.db, request, {
        action: 'attribute.value.delete',
        module: 'settings',
        entity: 'attribute',
        entityId: id,
        entityLabel: value.value,
      });

      return noContent(reply);
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

        /*
         * The slug moves only when it is the field being changed.
         *
         * It is the key in the storefront's filter query string — `?size=m` is
         * this row's slug and its value's — so a rename must not move it, or
         * every filtered link a shop has shared stops selecting anything. The
         * update used to omit the column entirely, which made the slug
         * permanent: an attribute created as "Colour" and renamed to "Shade"
         * kept filtering on `colour` with nothing in the panel to say so.
         */
        const slug = body.slug === undefined ? existing.slug : slugify(body.slug || body.name);

        if (slug !== existing.slug) {
          const [clash] = await tx
            .select({ id: attributes.id })
            .from(attributes)
            .where(and(eq(attributes.slug, slug), ne(attributes.id, id)))
            .limit(1);

          if (clash) throw conflict('Another attribute already uses that slug.');
        }

        const [row] = await tx
          .update(attributes)
          .set({
            name: body.name,
            slug,
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
}
