import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { damageReason, inventoryTransactionType } from './enums';
import { productVariants } from './catalog';

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 140 }).notNull(),
    code: varchar('code', { length: 24 }).notNull(),
    address: text('address'),
    city: varchar('city', { length: 80 }),
    country: varchar('country', { length: 80 }),
    phone: varchar('phone', { length: 24 }),
    /** Exactly one default; the API refuses to unset the last one. */
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('warehouses_code_key').on(table.code)],
);

/**
 * Stock for one variant in one warehouse, split into buckets.
 *
 * The CHECK constraints are the real guarantee. Zod validates the request; the
 * database refuses the write. A concurrent decrement that would drive a bucket
 * negative fails at the constraint even if two requests read the same value —
 * which is why every mutation is a single conditional `UPDATE`, never a
 * read-modify-write.
 */
export const inventoryLevels = pgTable(
  'inventory_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),

    /** Sellable right now. */
    available: integer('available').notNull().default(0),
    /** Committed to an unfulfilled order. Already deducted from `available`. */
    reserved: integer('reserved').notNull().default(0),
    /** Physically back, awaiting an inspection decision. Never sellable. */
    returnPending: integer('return_pending').notNull().default(0),
    damaged: integer('damaged').notNull().default(0),
    /** On a purchase order, not yet received. */
    incoming: integer('incoming').notNull().default(0),

    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_levels_variant_warehouse_key').on(table.variantId, table.warehouseId),
    index('inventory_levels_warehouse_idx').on(table.warehouseId),
    check('inventory_levels_available_check', sql`${table.available} >= 0`),
    check('inventory_levels_reserved_check', sql`${table.reserved} >= 0`),
    check('inventory_levels_return_pending_check', sql`${table.returnPending} >= 0`),
    check('inventory_levels_damaged_check', sql`${table.damaged} >= 0`),
    check('inventory_levels_incoming_check', sql`${table.incoming} >= 0`),
  ],
);

/**
 * Append-only ledger. **Every** change to `inventory_levels` writes a row here in
 * the same transaction — there is no code path that moves stock silently, so the
 * ledger can always be replayed to explain a level.
 */
export const inventoryTransactions = pgTable(
  'inventory_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),

    type: inventoryTransactionType('type').notNull(),
    /** Signed. Negative removes from the bucket. */
    quantity: integer('quantity').notNull(),
    fromBucket: varchar('from_bucket', { length: 20 }),
    toBucket: varchar('to_bucket', { length: 20 }),

    /** Snapshot after the move, so a report never has to re-derive it. */
    availableAfter: integer('available_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),

    referenceType: varchar('reference_type', { length: 32 }),
    referenceId: varchar('reference_id', { length: 64 }),
    damageReason: damageReason('damage_reason'),
    note: varchar('note', { length: 300 }),

    /** Null for system moves such as an order reservation. */
    adminId: uuid('admin_id'),
    adminLabel: varchar('admin_label', { length: 254 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inventory_transactions_variant_idx').on(table.variantId, table.createdAt),
    index('inventory_transactions_reference_idx').on(table.referenceType, table.referenceId),
    index('inventory_transactions_created_idx').on(table.createdAt),
  ],
);
