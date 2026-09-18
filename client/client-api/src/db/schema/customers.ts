import {
  boolean,
  date,
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
import {
  addressType,
  backInStockStatus,
  customerIdentityProvider,
  customerStatus,
  customerTokenPurpose,
  customerType,
} from './enums';
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
    /**
     * Nullable since phone sign-up: an account created from a phone number has
     * no address until its owner adds one. Postgres treats NULLs in a unique
     * index as distinct, so `customers_email_key` keeps working unchanged.
     */
    email: varchar('email', { length: 254 }),
    fullName: varchar('full_name', { length: 140 }).notNull(),
    /** The contact number as it was typed. Free text, not an identity. */
    phone: varchar('phone', { length: 24 }),
    /**
     * The same number in E.164, and the thing a phone sign-in actually matches.
     *
     * Kept apart from `phone` on purpose. That column has always been a contact
     * detail an admin or a customer could type anything into, so it holds
     * whatever historical shapes a store has collected and cannot carry a unique
     * index without a data migration that would have to discard somebody's
     * number. This one is written **only** by a passed OTP, so every value in it
     * is normalised, unique, and proved to belong to whoever holds the handset.
     */
    phoneE164: varchar('phone_e164', { length: 20 }),
    passwordHash: text('password_hash'),

    status: customerStatus('status').notNull().default('active'),
    /** Derived from order history on a schedule, never accepted from a request. */
    customerType: customerType('customer_type').notNull().default('new'),

    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    acceptsMarketing: boolean('accepts_marketing').notNull().default(false),
    /**
     * `YYYY-MM-DD`, given by the customer on their own profile. It is what a
     * birthday offer is checked against, and nothing else reads it.
     */
    birthDate: date('birth_date', { mode: 'string' }),

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
    uniqueIndex('customers_phone_e164_key').on(table.phoneE164),
    index('customers_status_idx').on(table.status),
    index('customers_type_idx').on(table.customerType),
    index('customers_created_idx').on(table.createdAt),
  ],
);

/**
 * A sign-in provider linked to a shopper's account — today only Google.
 *
 * Its own table rather than a column on `customers` for two reasons. A second
 * provider is then a row rather than a migration; and the subject id, which is
 * the thing that actually authenticates, stays out of the row that every
 * customer-facing endpoint selects from.
 *
 * **`subject` is what identifies the account, never the email.** Google's
 * `sub` is stable for the life of the account; the address on it is not — a
 * Workspace user can have theirs changed by an administrator, and a Gmail
 * address freed up can in principle be reissued. Matching on the address would
 * mean a renamed account silently becomes a second customer, and a reissued one
 * silently becomes somebody else's.
 */
export const customerIdentities = pgTable(
  'customer_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    provider: customerIdentityProvider('provider').notNull(),
    /** The provider's own immutable id for this person. */
    subject: varchar('subject', { length: 255 }).notNull(),
    /** What the provider said the address was when it was last used, for support. */
    email: varchar('email', { length: 254 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customer_identities_provider_subject_key').on(table.provider, table.subject),
    index('customer_identities_customer_idx').on(table.customerId),
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
