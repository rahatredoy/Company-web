import {
  boolean,
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
import { paymentProvider, paymentTransactionStatus } from './enums';
import { orders } from './orders';

/**
 * One payment attempt against an order.
 *
 * `status` here is the authority for whether money moved — it is only ever
 * written from a server-to-server verification or a signature-checked webhook.
 * A browser returning from a gateway with `?status=success` proves nothing and
 * is never trusted.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    provider: paymentProvider('provider').notNull(),
    status: paymentTransactionStatus('status').notNull().default('pending'),

    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    /** Sum of refunds already issued against this payment. */
    refundedAmount: numeric('refunded_amount', { precision: 14, scale: 2 }).notNull().default('0'),

    /** The gateway's own identifier, used to reconcile and to refund. */
    providerReference: varchar('provider_reference', { length: 160 }),
    /** Opaque token the checkout hands the browser to start a hosted payment. */
    clientReference: varchar('client_reference', { length: 160 }),

    failureReason: varchar('failure_reason', { length: 200 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_order_idx').on(table.orderId),
    index('payments_status_idx').on(table.status),
    uniqueIndex('payments_provider_reference_key').on(table.provider, table.providerReference),
  ],
);

/**
 * Webhook idempotency. The unique index on `(provider, event_id)` is what makes
 * a replayed delivery a no-op — gateways retry, and a retried "payment
 * succeeded" must not credit an order twice.
 */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paymentProvider('provider').notNull(),
    eventId: varchar('event_id', { length: 160 }).notNull(),
    eventType: varchar('event_type', { length: 80 }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    signatureValid: boolean('signature_valid').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    payload: jsonb('payload'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_webhook_events_key').on(table.provider, table.eventId),
    index('payment_webhook_events_created_idx').on(table.createdAt),
  ],
);

/** Which payment methods this store offers. Only enabled rows reach checkout. */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paymentProvider('provider').notNull(),
    label: varchar('label', { length: 60 }).notNull(),
    description: varchar('description', { length: 200 }),
    instructions: text('instructions'),
    isEnabled: boolean('is_enabled').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Gateway keys, AES-256-GCM encrypted. Never leaves the API. */
    credentialsEncrypted: text('credentials_encrypted'),
    /** Optional order-value bounds, e.g. no COD above a limit. */
    minOrderTotal: numeric('min_order_total', { precision: 12, scale: 2 }),
    maxOrderTotal: numeric('max_order_total', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('payment_methods_provider_key').on(table.provider)],
);
