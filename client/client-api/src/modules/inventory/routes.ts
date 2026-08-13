import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
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
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'in_stock', 'low', 'out']).default('all'),
  warehouseId: z.string().uuid().optional(),
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

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: inventoryLevels.id,
            variantId: productVariants.id,
            productId: products.id,
            productName: products.name,
            sku: productVariants.sku,
            variantTitle: productVariants.title,
            warehouseId: warehouses.id,
            warehouseName: warehouses.name,
            available: inventoryLevels.available,
            reserved: inventoryLevels.reserved,
            returnPending: inventoryLevels.returnPending,
            damaged: inventoryLevels.damaged,
            incoming: inventoryLevels.incoming,
            lowStockThreshold: inventoryLevels.lowStockThreshold,
            updatedAt: inventoryLevels.updatedAt,
          })
          .from(inventoryLevels)
          .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .innerJoin(warehouses, eq(warehouses.id, inventoryLevels.warehouseId))
          .where(where)
          // Emptiest first: the list exists to be acted on, and the rows that
          // need acting on are the ones about to run out.
          .orderBy(asc(inventoryLevels.available), asc(products.name))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),

        store.db
          .select({ total: count() })
          .from(inventoryLevels)
          .innerJoin(productVariants, eq(productVariants.id, inventoryLevels.variantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
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
}
