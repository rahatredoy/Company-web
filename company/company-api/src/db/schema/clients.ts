import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { clientAccountStatus, onboardingStep } from './enums';

/**
 * The SaaS account a business owner uses to manage their subscription. This is
 * NOT the future store-admin login — that lives in the tenant platform.
 */
export const clientAccounts = pgTable(
  'client_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    phone: varchar('phone', { length: 24 }),
    passwordHash: text('password_hash').notNull(),
    status: clientAccountStatus('status').notNull().default('pending_verification'),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    onboardingStep: onboardingStep('onboarding_step').notNull().default('plan'),
    onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
    /**
     * Stamped the first time this account starts the free-trial plan. The trial
     * is once per account for life, so the record has to outlive the tenant,
     * the subscription and the trial row itself — all three can be replaced.
     */
    trialUsedAt: timestamp('trial_used_at', { withTimezone: true }),
    /** Plan chosen before registration (from a pricing-page link), applied during onboarding. */
    intendedPlanCode: varchar('intended_plan_code', { length: 40 }),
    intendedBillingCycle: varchar('intended_billing_cycle', { length: 10 }),
    acceptedTermsAt: timestamp('accepted_terms_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 64 }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('client_accounts_email_key').on(table.email),
    index('client_accounts_status_idx').on(table.status),
    index('client_accounts_created_idx').on(table.createdAt),
  ],
);

export const clientLoginAttempts = pgTable(
  'client_login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    successful: boolean('successful').notNull().default(false),
    failureReason: varchar('failure_reason', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('client_login_attempts_email_idx').on(table.email, table.createdAt),
    index('client_login_attempts_ip_idx').on(table.ipAddress, table.createdAt),
  ],
);

/**
 * The six-digit passcode that activates a new account. Single-use, hashed, and
 * self-expiring — the digits themselves only ever exist in the email.
 *
 * The code is *not* unique-indexed: six digits repeat across accounts, and a
 * uniqueness constraint would make one signup fail because an unrelated account
 * happened to draw the same number. It is looked up by account instead, which is
 * also what keeps a code issued for one address from working on another.
 */
export const clientEmailVerificationTokens = pgTable(
  'client_email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    /** Wrong guesses against this code; the row is burned once the cap is hit. */
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('client_email_verification_tokens_account_idx').on(table.clientAccountId)],
);

export const clientPasswordResetTokens = pgTable(
  'client_password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: varchar('requested_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('client_password_reset_tokens_hash_key').on(table.tokenHash),
    index('client_password_reset_tokens_account_idx').on(table.clientAccountId),
  ],
);

/**
 * Invoice identity for the account. Signup only asks for the business name — the
 * rest is optional and filled in later from the billing page, so nothing but the
 * name is required to get a store created.
 */
export const clientBusinessProfiles = pgTable(
  'client_business_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    businessName: varchar('business_name', { length: 160 }).notNull(),
    ownerName: varchar('owner_name', { length: 120 }).notNull(),
    businessEmail: varchar('business_email', { length: 254 }).notNull(),
    businessPhone: varchar('business_phone', { length: 24 }),
    country: varchar('country', { length: 60 }),
    address: text('address'),
    businessType: varchar('business_type', { length: 40 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('client_business_profiles_account_key').on(table.clientAccountId)],
);
