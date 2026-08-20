import { and, asc, count, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  inventoryLevels,
  inventoryTransactions,
  productVariants,
  products,
  warehouses,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { INVENTORY_BUCKETS } from '../../lib/constants';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { storeOf } from '../../plugins/tenant';

/** Postgres `check_violation`. */
const CHECK_VIOLATION = '23514';

/**
 * Walks an error and its causes for a CHECK-constraint failure.
 *
 * Drizzle wraps driver errors, so the SQLSTATE is not on the error it throws —
 * it is one or two `cause` links down. Matching on the message text instead
 * looks like it works and does not: the wrapper's message is the SQL, which
 * contains the table name but never the constraint name.
 */
function isCheckViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if ((current as { code?: string }).code === CHECK_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'in_stock', 'low', 'out']).default('all'),
  warehouseId: z.string().uuid().optional(),
  /**
   * Default is `available` ascending — emptiest first. The list exists to be
   * acted on, and the rows that need acting on are the ones about to run out.
   */
  sort: z.enum(['available', 'reserved', 'product', 'warehouse', 'updatedAt']).default('available'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

/** The columns the cursor is built from — a subset of what the list selects. */
interface InventoryListRow {
  id: string;
  productName: string;
  warehouseName: string;
  available: number;
  reserved: number;
  updatedAt: Date;
}

const CURSOR_VALUE = {
  available: (row: InventoryListRow) => row.available,
  reserved: (row: InventoryListRow) => row.reserved,
  product: (row: InventoryListRow) => row.productName,
  warehouse: (row: InventoryListRow) => row.warehouseName,
  updatedAt: (row: InventoryListRow) => row.updatedAt,
} as const;

/** Changing the warning line, without moving a single unit. */
const thresholdSchema = z.object({
  variantId: z.string().uuid('Choose a product.'),
  warehouseId: z.string().uuid('Choose a warehouse.'),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000),
});

const warehousePatchSchema = z.object({
  name: z.string().trim().min(1, 'Give the warehouse a name.').max(140).optional(),
  code: z.string().trim().min(1, 'Give it a short code.').max(24).optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(24).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const adjustSchema = z.object({
  variantId: z.string().uuid('Choose a product.'),
  warehouseId: z.string().uuid('Choose a warehouse.'),
  bucket: z.enum(INVENTORY_BUCKETS).default('available'),
  /** Signed. Negative removes; the CHECK constraints refuse an overdraw. */
  delta: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Enter an amount.'),
  reason: z.string().trim().max(300).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000).optional(),
});

const warehouseSchema = z.object({
  name: z.string().trim().min(1, 'Give the warehouse a name.').max(140),
  code: z.string().trim().min(1, 'Give it a short code.').max(24),
  address: z.string().trim().max(2000).nullable().default(null),
  city: z.string().trim().max(80).nullable().default(null),
  country: z.string().trim().max(80).nullable().default(null),
  phone: z.string().trim().max(24).nullable().default(null),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

/**
 * Stock levels and the ledger behind them.
 *
 * **Every change is a single conditional `UPDATE` and writes a ledger row in the
 * same transaction.** Not because it is tidier, but because two admins adjusting
 * the same variant at once would otherwise each read the old value and the
 * second write would erase the first. The `>= 0` CHECK constraints on each
 * bucket are the last line: a removal that would go negative fails the statement
 * rather than being clamped to zero and quietly losing the difference.
 */
export default async function inventoryRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  app.get(
    '/inventory',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(ilike(products.name, `%${query.search}%`), ilike(productVariants.sku, `%${query.search}%`))
          : undefined,
        query.warehouseId ? eq(inventoryLevels.warehouseId, query.warehouseId) : undefined,
        query.status === 'out'
          ? sql`${inventoryLevels.available} <= 0`
          : query.status === 'low'
            ? sql`${inventoryLevels.available} > 0 and ${inventoryLevels.available} <= ${inventoryLevels.lowStockThreshold}`
            : query.status === 'in_stock'
              ? sql`${inventoryLevels.available} > ${inventoryLevels.lowStockThreshold}`
              : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      const SORTABLE = {
        available: inventoryLevels.available,
        reserved: inventoryLevels.reserved,
        product: products.name,
        warehouse: warehouses.name,
        updatedAt: inventoryLevels.updatedAt,
      } as const;

      /*
       * Chosen column, then product name, then the level's own id. The name keeps
       * the old tie-break; the id is what makes the order *total*, which the
       * cursor needs — a position in an order with ties is not a position, and a
       * row either side of one would arrive twice or never.
       *
       * The previous tie-break used the SKU, which is nullable: `sku < NULL` is
       * NULL, so every unbarcoded variant would vanish after the first batch.
       */
      const page = keyset<InventoryListRow>([
        { expr: SORTABLE[query.sort], order: query.order, of: (row) => CURSOR_VALUE[query.sort](row) },
        ...(query.sort === 'product'
          ? []
          : [{ expr: products.name, order: 'asc' as const, of: (row: InventoryListRow) => row.productName }]),
        { expr: inventoryLevels.id, order: 'asc' as const, of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: inventoryLevels.id,
            variantId: productVariants.id,
            productId: products.id,
            productName: products.name,
            productSlug: products.slug,
            sku: productVariants.sku,
            variantTitle: productVariants.title,
            /** For the row's thumbnail, and for what the stock is worth at cost. */
            imageUrl: productVariants.imageUrl,
            costPrice: productVariants.costPrice,
            price: productVariants.price,
            warehouseId: warehouses.id,
            warehouseName: warehouses.name,
            available: inventoryLevels.available,
            reserved: inventoryLevels.reserved,
            returnPending: inventoryLevels.returnPending,
            damaged: inventoryLevels.damaged,
            incoming: inventoryLevels.incoming,
            lowStockThreshold: inventoryLevels.lowStockThreshold,
            /*
             * The unit the counts above are in.
             *
             * For a product sold by measure every one of them counts base units
             * — 40000 grams, not 40000 pumpkins — and a screen that printed the
             * bare number would be telling the owner they have forty thousand of
             * something. The panel formats with it; null means whole items.
             */
            measureUnit: products.measureUnit,
            updatedAt: inventoryLevels.updatedAt,
          })
          .from(inventoryLevels)
          .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .innerJoin(warehouses, eq(warehouses.id, inventoryLevels.warehouseId))
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor
          ? undefined
          : store.db
              .select({ total: count() })
              .from(inventoryLevels)
              .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
              .innerJoin(products, eq(products.id, productVariants.productId))
              .where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
        {
          pageSize: query.pageSize,
          nextCursor: batch.nextCursor,
          hasMore: batch.hasMore,
          total: tally ? Number(tally[0]?.total ?? 0) : undefined,
        },
      );
    },
  );

  /**
   * The figures above the list, counted over every tracked level rather than the
   * page on screen. `value_at_cost` is what the shelves are worth to the shop —
   * null cost prices contribute nothing rather than counting as free.
   *
   * Registered before `/inventory/:id/transactions`; find-my-way matches the
   * static segment first regardless.
   */
  app.get(
    '/inventory/stats',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.view')] },
    async (request, reply) => {
      const store = storeOf(request);

      const result = await store.db.execute<{
        tracked: number;
        in_stock: number;
        low: number;
        out: number;
        units_available: number;
        units_reserved: number;
        units_incoming: number;
        units_damaged: number;
        value_at_cost: string;
        warehouses: number;
        products_untracked: number;
      }>(sql`
        select
          count(*)::int as tracked,
          count(*) filter (where l.available > l.low_stock_threshold)::int as in_stock,
          count(*) filter (where l.available > 0 and l.available <= l.low_stock_threshold)::int as low,
          count(*) filter (where l.available <= 0)::int as out,
          coalesce(sum(l.available), 0)::int as units_available,
          coalesce(sum(l.reserved), 0)::int as units_reserved,
          coalesce(sum(l.incoming), 0)::int as units_incoming,
          coalesce(sum(l.damaged), 0)::int as units_damaged,
          coalesce(sum(l.available * coalesce(v.cost_price, 0)), 0)::numeric(14,2)::text as value_at_cost,
          (select count(*)::int from ${warehouses}) as warehouses,
          (select count(*)::int from ${productVariants} pv
            where not exists (select 1 from ${inventoryLevels} il where il.variant_id = pv.id)
          ) as products_untracked
        from ${inventoryLevels} l
        join ${productVariants} v on v.id = l.variant_id
      `);

      const row = result.rows?.[0];

      return ok(reply, {
        tracked: Number(row?.tracked ?? 0),
        inStock: Number(row?.in_stock ?? 0),
        low: Number(row?.low ?? 0),
        out: Number(row?.out ?? 0),
        unitsAvailable: Number(row?.units_available ?? 0),
        unitsReserved: Number(row?.units_reserved ?? 0),
        unitsIncoming: Number(row?.units_incoming ?? 0),
        unitsDamaged: Number(row?.units_damaged ?? 0),
        valueAtCost: row?.value_at_cost ?? '0',
        warehouses: Number(row?.warehouses ?? 0),
        /** Variants with no level row at all — unsellable, and easy to miss. */
        untrackedVariants: Number(row?.products_untracked ?? 0),
      });
    },
  );

  /**
   * The low-stock warning line, on its own.
   *
   * `/inventory/adjust` cannot do this: its `delta` must be non-zero, because an
   * adjustment of nothing is a mistake worth refusing. But the threshold is not a
   * quantity — nothing moves, so there is nothing for the ledger to record, and
   * making an owner invent a +1/−1 to change a warning line would write two false
   * movements into the history that explains their stock.
   */
  app.patch(
    '/inventory/threshold',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.adjust')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(thresholdSchema, request.body);

      const [updated] = await store.db
        .update(inventoryLevels)
        .set({ lowStockThreshold: body.lowStockThreshold, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryLevels.variantId, body.variantId),
            eq(inventoryLevels.warehouseId, body.warehouseId),
          ),
        )
        .returning({
          id: inventoryLevels.id,
          available: inventoryLevels.available,
          lowStockThreshold: inventoryLevels.lowStockThreshold,
        });

      if (!updated) {
        throw notFound('That stock record does not exist. Adjust the stock once to create it.');
      }

      await audit(store.db, request, {
        action: 'inventory.threshold',
        module: 'inventory',
        entity: 'variant',
        entityId: body.variantId,
        newValues: { lowStockThreshold: body.lowStockThreshold },
      });

      return ok(reply, updated);
    },
  );

  /**
   * One stock level, whole — and everything that decides what it means.
   *
   * **`:id` here is the `inventory_levels` id**, which is what the list row
   * carries, and deliberately *not* what `/inventory/:id/transactions` takes:
   * that one is keyed by variant, because the ledger is per variant and spans
   * every warehouse. The two are documented rather than reconciled — the ledger
   * route is what the stock-history drawer already calls — so this returns its
   * own copy of the movements for this warehouse and the panel needs one call.
   *
   * The variant's own `track_inventory` is on the product, and it is the
   * difference between a level of zero that refuses a sale and one that does
   * not, so the product's flags come with it. Reserved and damaged units are
   * already excluded from `available`; the sum is reported as `onHand` so that
   * a screen showing five buckets does not invite the reader to add them up
   * differently every time.
   */
  app.get(
    '/inventory/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db
        .select({
          level: inventoryLevels,
          variant: productVariants,
          product: {
            id: products.id,
            name: products.name,
            slug: products.slug,
            status: products.status,
            productType: products.type,
            trackInventory: products.trackInventory,
            isReturnable: products.isReturnable,
            minOrderQuantity: products.minOrderQuantity,
            maxOrderQuantity: products.maxOrderQuantity,
            soldCount: products.soldCount,
            /** The unit every count on this record is in. Null means whole items. */
            sellBy: products.sellBy,
            measureUnit: products.measureUnit,
            pricingLabel: products.pricingLabel,
          },
          warehouse: warehouses,
        })
        .from(inventoryLevels)
        .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(warehouses, eq(warehouses.id, inventoryLevels.warehouseId))
        .where(eq(inventoryLevels.id, id))
        .limit(1);

      if (!row) throw notFound('That stock record does not exist.');

      const [movements, elsewhere] = await Promise.all([
        store.db
          .select()
          .from(inventoryTransactions)
          .where(
            and(
              eq(inventoryTransactions.variantId, row.level.variantId),
              eq(inventoryTransactions.warehouseId, row.level.warehouseId),
            ),
          )
          .orderBy(desc(inventoryTransactions.createdAt))
          .limit(50),

        // The same variant in the other warehouses, so a level that reads as
        // empty is not mistaken for a variant that is out of stock everywhere.
        store.db
          .select({
            id: inventoryLevels.id,
            warehouseId: warehouses.id,
            warehouseName: warehouses.name,
            warehouseCode: warehouses.code,
            available: inventoryLevels.available,
            reserved: inventoryLevels.reserved,
            damaged: inventoryLevels.damaged,
            incoming: inventoryLevels.incoming,
            returnPending: inventoryLevels.returnPending,
          })
          .from(inventoryLevels)
          .innerJoin(warehouses, eq(warehouses.id, inventoryLevels.warehouseId))
          .where(and(eq(inventoryLevels.variantId, row.level.variantId), ne(inventoryLevels.id, id)))
          .orderBy(asc(warehouses.name)),
      ]);

      return ok(reply, {
        ...row.level,
        updatedAt: row.level.updatedAt.toISOString(),
        /** Everything physically in the building, sellable or not. */
        onHand: row.level.available + row.level.reserved + row.level.returnPending + row.level.damaged,
        variant: {
          ...row.variant,
          createdAt: row.variant.createdAt.toISOString(),
          updatedAt: row.variant.updatedAt.toISOString(),
        },
        product: row.product,
        warehouse: {
          ...row.warehouse,
          createdAt: row.warehouse.createdAt.toISOString(),
          updatedAt: row.warehouse.updatedAt.toISOString(),
        },
        otherWarehouses: elsewhere,
        transactions: movements.map((movement) => ({
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        })),
      });
    },
  );

  /** The ledger for one variant — how a level came to be what it is. */
  app.get(
    '/inventory/:id/transactions',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const rows = await store.db
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.variantId, id))
        .orderBy(desc(inventoryTransactions.createdAt))
        .limit(100);

      return ok(reply, rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
    },
  );

  app.post(
    '/inventory/adjust',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.adjust')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(adjustSchema, request.body);

      const result = await store.db.transaction(async (tx) => {
        const [variant] = await tx
          .select({ id: productVariants.id, sku: productVariants.sku, productName: products.name })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(eq(productVariants.id, body.variantId))
          .limit(1);

        if (!variant) throw notFound('That product does not exist.');

        // Creates the row on first adjustment: a variant that has never had
        // stock recorded has no level, and requiring one to be made first would
        // be a step with no meaning.
        await tx
          .insert(inventoryLevels)
          .values({
            variantId: body.variantId,
            warehouseId: body.warehouseId,
            ...(body.lowStockThreshold === undefined ? {} : { lowStockThreshold: body.lowStockThreshold }),
          })
          .onConflictDoNothing();

        /*
         * `sql.raw` with a request value, safely: `INVENTORY_BUCKETS` is a
         * five-element literal union and Zod has already refused anything else,
         * so this can only ever be one of five known column names. A bucket
         * cannot be a bound parameter — it is an identifier, not a value.
         */
        const column = sql.raw(body.bucket);

        let updated;
        try {
          updated = await tx.execute<{ available: number; reserved: number }>(sql`
            update inventory_levels
               set ${column} = ${column} + ${body.delta},
                   ${body.lowStockThreshold === undefined ? sql`updated_at = now()` : sql`low_stock_threshold = ${body.lowStockThreshold}, updated_at = now()`}
             where variant_id = ${body.variantId}::uuid
               and warehouse_id = ${body.warehouseId}::uuid
            returning available, reserved
          `);
        } catch (error) {
          // The CHECK constraint fired: the removal was larger than the bucket.
          // Matched on the SQLSTATE rather than the message — Drizzle wraps the
          // driver error, so the constraint name is on the `cause`, not on
          // `message`, and a string match silently became a 500.
          if (isCheckViolation(error)) {
            throw unprocessable(
              'There is not that much stock in that bucket.',
              ERROR_CODES.INSUFFICIENT_STOCK,
              { delta: ['There is not that much stock to remove.'] },
            );
          }
          throw error;
        }

        const row = updated.rows?.[0];
        if (!row) throw notFound('That stock record does not exist.');

        await tx.insert(inventoryTransactions).values({
          variantId: body.variantId,
          warehouseId: body.warehouseId,
          type: 'adjustment',
          quantity: body.delta,
          toBucket: body.bucket,
          availableAfter: Number(row.available),
          reservedAfter: Number(row.reserved),
          note: body.reason ?? null,
          adminId: request.storeAdmin!.adminId,
          adminLabel: request.storeAdmin!.email,
        });

        return { variant, available: Number(row.available), reserved: Number(row.reserved) };
      });

      await audit(store.db, request, {
        action: 'inventory.adjust',
        module: 'inventory',
        entity: 'variant',
        entityId: body.variantId,
        entityLabel: result.variant.sku,
        newValues: { bucket: body.bucket, delta: body.delta, available: result.available },
      });

      return ok(reply, { available: result.available, reserved: result.reserved });
    },
  );

  app.get(
    '/warehouses',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const rows = await store.db.select().from(warehouses).orderBy(desc(warehouses.isDefault), asc(warehouses.name));
      return ok(reply, rows);
    },
  );

  app.post(
    '/warehouses',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.adjust')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(warehouseSchema, request.body);

      const [clash] = await store.db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(sql`upper(${warehouses.code})`, body.code.toUpperCase()))
        .limit(1);

      if (clash) throw conflict('Another warehouse already uses that code.');

      const created = await store.db.transaction(async (tx) => {
        const existing = await tx.select({ id: warehouses.id }).from(warehouses).limit(1);
        const isDefault = body.isDefault || existing.length === 0;

        if (isDefault) await tx.update(warehouses).set({ isDefault: false });

        const [row] = await tx
          .insert(warehouses)
          .values({ ...body, code: body.code.toUpperCase(), isDefault })
          .returning();

        return row!;
      });

      await audit(store.db, request, {
        action: 'warehouse.create',
        module: 'inventory',
        entity: 'warehouse',
        entityId: created.id,
        entityLabel: created.name,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  /**
   * Editing a warehouse.
   *
   * **Exactly one default, always.** Naming a new one moves the flag; clearing the
   * flag on the only default is refused rather than silently leaving a store with
   * nowhere for `/inventory/adjust` and checkout to land. Deactivating is the way
   * to take a warehouse out of use.
   */
  app.patch(
    '/warehouses/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.adjust')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(warehousePatchSchema, request.body);

      const [existing] = await store.db.select().from(warehouses).where(eq(warehouses.id, id)).limit(1);
      if (!existing) throw notFound('That warehouse does not exist.');

      if (body.code && body.code.toUpperCase() !== existing.code.toUpperCase()) {
        const [clash] = await store.db
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(sql`upper(${warehouses.code})`, body.code.toUpperCase()), ne(warehouses.id, id)))
          .limit(1);
        if (clash) throw conflict('Another warehouse already uses that code.');
      }

      if (existing.isDefault && body.isDefault === false) {
        throw unprocessable(
          'Make another warehouse the default first — a store always needs one.',
          ERROR_CODES.VALIDATION_FAILED,
          { isDefault: ['Name a different default instead.'] },
        );
      }

      // Deactivating the default would leave the fallback pointing at a warehouse
      // nobody may use, which is the same problem wearing a different flag.
      if (existing.isDefault && body.isActive === false) {
        throw unprocessable(
          'The default warehouse cannot be deactivated. Make another one the default first.',
          ERROR_CODES.VALIDATION_FAILED,
          { isActive: ['Name a different default instead.'] },
        );
      }

      const updated = await store.db.transaction(async (tx) => {
        if (body.isDefault === true && !existing.isDefault) {
          await tx.update(warehouses).set({ isDefault: false, updatedAt: new Date() });
        }

        const [row] = await tx
          .update(warehouses)
          .set({
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
            ...(body.address === undefined ? {} : { address: body.address }),
            ...(body.city === undefined ? {} : { city: body.city }),
            ...(body.country === undefined ? {} : { country: body.country }),
            ...(body.phone === undefined ? {} : { phone: body.phone }),
            ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
            ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
            updatedAt: new Date(),
          })
          .where(eq(warehouses.id, id))
          .returning();

        return row!;
      });

      await audit(store.db, request, {
        action: 'warehouse.update',
        module: 'inventory',
        entity: 'warehouse',
        entityId: id,
        entityLabel: updated.name,
        oldValues: existing,
        newValues: updated,
      });

      return ok(reply, updated);
    },
  );

  /**
   * Deleting a warehouse.
   *
   * `inventory_levels` cascades from it, so a delete would take the counts with
   * it — silently, and with no ledger entry to explain where the units went. So it
   * is refused while anything is still on those shelves, refused for the default,
   * and refused for the last one standing.
   */
  app.delete(
    '/warehouses/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('inventory.adjust')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [existing] = await store.db.select().from(warehouses).where(eq(warehouses.id, id)).limit(1);
      if (!existing) throw notFound('That warehouse does not exist.');

      if (existing.isDefault) {
        throw conflict('The default warehouse cannot be deleted. Make another one the default first.');
      }

      const [held] = await store.db
        .select({
          units: sql<number>`coalesce(sum(
            ${inventoryLevels.available} + ${inventoryLevels.reserved} + ${inventoryLevels.returnPending}
            + ${inventoryLevels.damaged} + ${inventoryLevels.incoming}
          ), 0)::int`,
        })
        .from(inventoryLevels)
        .where(eq(inventoryLevels.warehouseId, id));

      if (Number(held?.units ?? 0) > 0) {
        throw conflict(
          `That warehouse still holds ${Number(held?.units ?? 0)} unit(s). Move or write them off first.`,
        );
      }

      await store.db.delete(warehouses).where(eq(warehouses.id, id));

      await audit(store.db, request, {
        action: 'warehouse.delete',
        module: 'inventory',
        entity: 'warehouse',
        entityId: id,
        entityLabel: existing.name,
        oldValues: existing,
      });

      return noContent(reply);
    },
  );
}
