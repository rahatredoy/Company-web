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
import { addressType, backInStockStatus, customerStatus, customerTokenPurpose, customerType } from './enums';
import { productVariants, products } from './catalog';

/**
 * A shopper's account on **this store only**. Customers are per-tenant by
 * construction: the row lives in the tenant's own database, so the same email
 * at two different stores is two unrelated people with unrelated passwords.
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    fullName: varchar('full_name', { length: 140 }).notNull(),
    phone: varchar('phone', { length: 24 }),
    passwordHash: text('password_hash'),

    status: customerStatus('status').notNull().default('active'),
    /** Derived from order history on a schedule, never accepted from a request. */
    customerType: customerType('customer_type').notNull().default('new'),

    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    acceptsMarketing: boolean('accepts_marketing').notNull().default(false),

    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 64 }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),

    /** Staff-only note. Never returned by a customer-facing endpoint. */
    adminNote: text('admin_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customers_email_key').on(table.email),
    index('customers_status_idx').on(table.status),
    index('customers_type_idx').on(table.customerType),
    index('customers_created_idx').on(table.createdAt),
  ],
);

/**
 * A fourth, isolated audience. The cookie name (`store_customer_session`) and
 * this table are both distinct from the store-admin pair, so an admin cookie can
 * never authenticate a customer route and vice versa.
 */
export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    tenantRef: varchar('tenant_ref', { length: 24 }).notNull(),
    remember: boolean('remember').notNull().default(false),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customer_sessions_token_key').on(table.tokenHash),
    index('customer_sessions_customer_idx').on(table.customerId),
    index('customer_sessions_expires_idx').on(table.expiresAt),
  ],
);

export const customerTokens = pgTable(
  'customer_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    purpose: customerTokenPurpose('purpose').notNull().default('password_reset'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: varchar('requested_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customer_tokens_hash_key').on(table.tokenHash),
    index('customer_tokens_customer_idx').on(table.customerId),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 40 }),
    type: addressType('type').notNull().default('shipping'),

    fullName: varchar('full_name', { length: 140 }).notNull(),
    phone: varchar('phone', { length: 24 }).notNull(),
    addressLine1: varchar('address_line1', { length: 200 }).notNull(),
    addressLine2: varchar('address_line2', { length: 200 }),
    city: varchar('city', { length: 80 }).notNull(),
    state: varchar('state', { length: 80 }),
    postalCode: varchar('postal_code', { length: 20 }),
    country: varchar('country', { length: 80 }).notNull(),

    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('customer_addresses_customer_idx').on(table.customerId)],
);

/**
 * Rolled up by the order pipeline so the customers list can sort and segment
 * without scanning every order.
 */
export const customerStats = pgTable(
  'customer_stats',
  {
    customerId: uuid('customer_id')
      .primaryKey()
      .references(() => customers.id, { onDelete: 'cascade' }),
    totalOrders: integer('total_orders').notNull().default(0),
    completedOrders: integer('completed_orders').notNull().default(0),
    cancelledOrders: integer('cancelled_orders').notNull().default(0),
    totalSpent: numeric('total_spent', { precision: 14, scale: 2 }).notNull().default('0'),
    averageOrderValue: numeric('average_order_value', { precision: 12, scale: 2 }).notNull().default('0'),
    firstOrderAt: timestamp('first_order_at', { withTimezone: true }),
    lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('customer_stats_spent_idx').on(table.totalSpent)],
);

/**
 * "Notify me when available". Guests are captured by email, so the request must
 * carry its own contact details rather than assuming an account.
 */
export const backInStockRequests = pgTable(
  'back_in_stock_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    email: varchar('email', { length: 254 }).notNull(),
    status: backInStockStatus('status').notNull().default('pending'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One pending request per address per variant — re-submitting is a no-op
    // rather than a way to send yourself many emails.
    uniqueIndex('back_in_stock_unique').on(table.variantId, table.email),
    index('back_in_stock_status_idx').on(table.status, table.createdAt),
  ],
);
