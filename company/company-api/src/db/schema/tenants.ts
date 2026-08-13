import {
  boolean,
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
import { clientAccounts, clientBusinessProfiles } from './clients';
import {
  domainStatus,
  domainType,
  provisioningStatus,
  provisioningStep,
  storeStatus,
  tenantStatus,
} from './enums';

/**
 * One tenant per client store. The tenant's commerce data lives in its own
 * database (`databaseName`); this table only records that it exists.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-facing identifier, e.g. TNT-7F3K9QX2. */
    tenantRef: varchar('tenant_ref', { length: 24 }).notNull(),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    businessProfileId: uuid('business_profile_id').references(() => clientBusinessProfiles.id, {
      onDelete: 'set null',
    }),
    storeName: varchar('store_name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 40 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    language: varchar('language', { length: 8 }).notNull().default('en'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    storefrontTemplate: varchar('storefront_template', { length: 40 }).notNull().default('modern-shop'),
    status: tenantStatus('status').notNull().default('pending'),
    storeStatus: storeStatus('store_status').notNull().default('not_created'),
    /**
     * Login the owner chose for their store admin panel. The hash is a staging
     * area only: provisioning copies it into the tenant database and then clears
     * it, so the live credential lives in exactly one place.
     */
    storeAdminEmail: varchar('store_admin_email', { length: 254 }),
    storeAdminPasswordHash: text('store_admin_password_hash'),
    /**
     * Proof that the address above can actually be read. Setup emails it a
     * passcode and provisioning refuses to start until this is set, so a typo
     * cannot hand someone a panel whose only login they cannot receive.
     */
    storeAdminEmailVerifiedAt: timestamp('store_admin_email_verified_at', { withTimezone: true }),
    /**
     * One passcode challenge at a time — confirming the login at setup, or
     * resetting its password later. Stored as SHA-256 for the same reason
     * sign-in codes are: a read of this table must not hand out working codes.
     */
    storeAdminOtpPurpose: varchar('store_admin_otp_purpose', { length: 32 }),
    storeAdminOtpHash: varchar('store_admin_otp_hash', { length: 64 }),
    storeAdminOtpExpiresAt: timestamp('store_admin_otp_expires_at', { withTimezone: true }),
    storeAdminOtpSentAt: timestamp('store_admin_otp_sent_at', { withTimezone: true }),
    storeAdminOtpAttempts: integer('store_admin_otp_attempts').notNull().default(0),
    /** Name of the dedicated database created by provisioning. Never exposed by an API. */
    databaseName: varchar('database_name', { length: 80 }),
    /**
     * Which server of the sharded tenant cluster holds that database, chosen at
     * provisioning time from the shard with the most room left.
     *
     * The id alone is published to `client-api`; the host and credentials behind
     * it are configuration on each side, never transmitted. `null` is a store
     * provisioned before the cluster was sharded, which is on the `legacy` shard.
     */
    databaseShard: varchar('database_shard', { length: 40 }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tenants_slug_key').on(table.slug),
    uniqueIndex('tenants_ref_key').on(table.tenantRef),
    uniqueIndex('tenants_client_key').on(table.clientAccountId),
    index('tenants_status_idx').on(table.status),
  ],
);

export const provisioningJobs = pgTable(
  'provisioning_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    status: provisioningStatus('status').notNull().default('pending'),
    currentStep: provisioningStep('current_step'),
    /** Steps completed so far, in order — drives the progress UI. */
    completedSteps: jsonb('completed_steps').$type<string[]>().notNull().default([]),
    attempts: text('attempts').notNull().default('0'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('provisioning_jobs_tenant_idx').on(table.tenantId),
    index('provisioning_jobs_status_idx').on(table.status),
  ],
);

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: varchar('domain', { length: 253 }).notNull(),
    domainType: domainType('domain_type').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verified: boolean('verified').notNull().default(false),
    status: domainStatus('status').notNull().default('pending'),
    /** Value the client publishes as a TXT record to prove ownership. */
    verificationToken: varchar('verification_token', { length: 64 }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('domains_domain_key').on(table.domain),
    index('domains_tenant_idx').on(table.tenantId),
    index('domains_status_idx').on(table.status),
  ],
);
