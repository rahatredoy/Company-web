import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { inspectionResult, refundStatus, returnResolution, returnStatus } from './enums';
import { orderItems, orders } from './orders';
import { customers } from './customers';

/**
 * A return request. Eligibility is decided entirely server-side — that the
 * customer owns the order, that it was delivered, that the window is open, that
 * the product is returnable, and that the quantity has not already been
 * returned.
 */
export const returns = pgTable(
  'returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnNumber: varchar('return_number', { length: 32 }).notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),

    status: returnStatus('status').notNull().default('requested'),
    resolution: returnResolution('resolution').notNull().default('refund'),

    reason: varchar('reason', { length: 60 }).notNull(),
    description: varchar('description', { length: 1000 }),

    /** Computed by the server from the accepted lines. Never sent by a browser. */
    refundableAmount: numeric('refundable_amount', { precision: 14, scale: 2 }).notNull().default('0'),

    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    rejectionReason: varchar('rejection_reason', { length: 300 }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    adminNote: text('admin_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('returns_number_key').on(table.returnNumber),
    index('returns_order_idx').on(table.orderId),
    index('returns_customer_idx').on(table.customerId, table.createdAt),
    index('returns_status_idx').on(table.status, table.createdAt),
  ],
);

export const returnItems = pgTable(
  'return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    /** Ties the request to a line the customer actually bought. */
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),

    quantity: integer('quantity').notNull(),
    /** Copied from the order line, so a later price change cannot inflate a refund. */
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),

    /** Filled at inspection. Only `good` puts stock back on sale. */
    inspectionResult: inspectionResult('inspection_result'),
    inspectionNote: varchar('inspection_note', { length: 300 }),
    restockedQuantity: integer('restocked_quantity').notNull().default(0),
  },
  (table) => [
    index('return_items_return_idx').on(table.returnId),
    uniqueIndex('return_items_unique').on(table.returnId, table.orderItemId),
    check('return_items_quantity_check', sql`${table.quantity} > 0`),
  ],
);

export const returnAttachments = pgTable(
  'return_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Randomised R2 key — the uploaded filename is never used. */
    objectKey: text('object_key').notNull(),
    mimeType: varchar('mime_type', { length: 60 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('return_attachments_return_idx').on(table.returnId)],
);

export const returnHistory = pgTable(
  'return_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    fromStatus: returnStatus('from_status'),
    toStatus: returnStatus('to_status').notNull(),
    note: varchar('note', { length: 300 }),
    adminId: uuid('admin_id'),
    adminLabel: varchar('admin_label', { length: 254 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('return_history_return_idx').on(table.returnId, table.createdAt)],
);

/**
 * A refund is always initiated by staff or by the return pipeline, never by the
 * customer. The amount is derived server-side and capped at what remains
 * refundable on the order.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refundNumber: varchar('refund_number', { length: 32 }).notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    returnId: uuid('return_id').references(() => returns.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    paymentId: uuid('payment_id'),

    status: refundStatus('status').notNull().default('requested'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    reason: varchar('reason', { length: 200 }),

    /** How the money went back — gateway reversal, cash, store credit. */
    method: varchar('method', { length: 40 }),
    providerReference: varchar('provider_reference', { length: 160 }),
    failureReason: varchar('failure_reason', { length: 200 }),

    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refunds_number_key').on(table.refundNumber),
    index('refunds_order_idx').on(table.orderId),
    index('refunds_customer_idx').on(table.customerId, table.createdAt),
    index('refunds_status_idx').on(table.status, table.createdAt),
    check('refunds_amount_check', sql`${table.amount} > 0`),
  ],
);
