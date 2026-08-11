import { sql } from 'drizzle-orm';
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
import { clientAccounts } from './clients';
import { tenants } from './tenants';
import {
  billingCycle,
  invoiceStatus,
  paymentStatus,
  planStatus,
  subscriptionStatus,
  supportLevel,
  trialStatus,
  webhookEventStatus,
} from './enums';

/** Pricing lives here, never in the frontend. NULL limit means unlimited. */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 60 }).notNull(),
    code: varchar('code', { length: 40 }).notNull(),
    description: varchar('description', { length: 200 }),
    monthlyPrice: numeric('monthly_price', { precision: 12, scale: 2 }).notNull().default('0'),
    yearlyPrice: numeric('yearly_price', { precision: 12, scale: 2 }).notNull().default('0'),
    productLimit: integer('product_limit'),
    adminLimit: integer('admin_limit'),
    storageLimitMb: integer('storage_limit_mb'),
    customDomainEnabled: boolean('custom_domain_enabled').notNull().default(false),
    customAdminDomainEnabled: boolean('custom_admin_domain_enabled').notNull().default(false),
    analyticsEnabled: boolean('analytics_enabled').notNull().default(false),
    reportsEnabled: boolean('reports_enabled').notNull().default(false),
    supportLevel: supportLevel('support_level').notNull().default('email'),
    status: planStatus('status').notNull().default('active'),
    isFeatured: boolean('is_featured').notNull().default(false),
    /**
     * The free-trial plan — a plan in its own right, not a discount on another
     * one. It is priced 0.00, taken once per account for life, and runs out
     * rather than converting: what happens after it is a plan the owner buys.
     */
    isTrial: boolean('is_trial').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('plans_code_key').on(table.code),
    index('plans_status_idx').on(table.status, table.sortOrder),
    // One trial plan, ever — the database refuses a second rather than leaving
    // "which one is the trial?" to whichever row a query happened to return.
    uniqueIndex('plans_single_trial_key')
      .on(table.isTrial)
      .where(sql`${table.isTrial}`),
  ],
);

/**
 * A trial starts only once provisioning succeeds, so no trial days are burned
 * on a store that never came up.
 */
export const trials = pgTable(
  'trials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: trialStatus('status').notNull().default('active'),
    /** Reminder day-counts already sent (e.g. [10, 5]) so none is sent twice. */
    remindersSent: jsonb('reminders_sent').$type<number[]>().notNull().default([]),
    extendedByDays: integer('extended_by_days').notNull().default(0),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trials_tenant_key').on(table.tenantId),
    index('trials_status_idx').on(table.status, table.endsAt),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    billingCycle: billingCycle('billing_cycle').notNull().default('monthly'),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    status: subscriptionStatus('status').notNull().default('trial'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    renewalAt: timestamp('renewal_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('subscriptions_tenant_key').on(table.tenantId),
    index('subscriptions_status_idx').on(table.status),
    index('subscriptions_renewal_idx').on(table.renewalAt),
  ],
);

/**
 * A payment is only ever marked `paid` by a signature-verified webhook — never
 * by a browser redirect.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 40 }).notNull(),
    /**
     * `subscription` moves money; `method_setup` is the zero-amount authorisation
     * a trial signup completes so a card is on file. Only the former activates a
     * subscription or raises an invoice.
     */
    purpose: varchar('purpose', { length: 24 }).notNull().default('subscription'),
    /** Our own idempotent reference, sent to the gateway and echoed back. */
    reference: varchar('reference', { length: 64 }).notNull(),
    transactionId: varchar('transaction_id', { length: 128 }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    billingCycle: billingCycle('billing_cycle').notNull().default('monthly'),
    status: paymentStatus('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_reference_key').on(table.reference),
    index('payments_tenant_idx').on(table.tenantId),
    index('payments_status_idx').on(table.status, table.createdAt),
    index('payments_transaction_idx').on(table.provider, table.transactionId),
  ],
);

/**
 * A card on file, as the gateway describes it. Only the gateway's token and the
 * display fragments it hands back are stored — no card number ever reaches this
 * platform, so there is nothing here that could be replayed as a payment.
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull(),
    /** The gateway's own handle for the stored instrument. */
    providerToken: varchar('provider_token', { length: 128 }).notNull(),
    brand: varchar('brand', { length: 40 }),
    last4: varchar('last4', { length: 4 }),
    expMonth: integer('exp_month'),
    expYear: integer('exp_year'),
    isDefault: boolean('is_default').notNull().default(false),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_methods_token_key').on(table.provider, table.providerToken),
    index('payment_methods_tenant_idx').on(table.tenantId),
    index('payment_methods_account_idx').on(table.clientAccountId),
  ],
);

/** `provider + event_id` is unique, which is what makes webhooks idempotent. */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 40 }).notNull(),
    eventId: varchar('event_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }),
    status: webhookEventStatus('status').notNull().default('received'),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    payload: jsonb('payload'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('payment_webhook_events_provider_event_key').on(table.provider, table.eventId),
    index('payment_webhook_events_status_idx').on(table.status),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    invoiceNumber: varchar('invoice_number', { length: 32 }).notNull(),
    sequence: integer('sequence').notNull(),
    billingCycle: billingCycle('billing_cycle').notNull().default('monthly'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    status: invoiceStatus('status').notNull().default('issued'),
    /** Snapshot of billing details at issue time, so history never changes. */
    billTo: jsonb('bill_to').$type<{
      businessName: string;
      ownerName: string;
      email: string;
      address: string | null;
      country: string | null;
    }>(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_number_key').on(table.invoiceNumber),
    index('invoices_tenant_idx').on(table.tenantId),
    index('invoices_status_idx').on(table.status, table.issuedAt),
  ],
);
