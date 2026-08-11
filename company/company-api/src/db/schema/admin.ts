import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { companyAdminStatus } from './enums';

/**
 * There is exactly ONE company admin. A partial unique index on a constant
 * expression enforces that at the database level — a second INSERT fails even
 * if application code is bypassed.
 */
export const companyAdmin = pgTable(
  'company_admin',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    status: companyAdminStatus('status').notNull().default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 64 }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Guard column: always 1, so the unique index below allows a single row. */
    singleton: integer('singleton').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('company_admin_singleton_key').on(table.singleton),
    uniqueIndex('company_admin_email_key').on(table.email),
  ],
);

export const companyAdminSessions = pgTable(
  'company_admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => companyAdmin.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** False until the emailed one-time passcode is accepted. */
    otpVerified: boolean('otp_verified').notNull().default(false),

    /*
     * The passcode lives on the challenge session rather than in a table of its
     * own. That makes it single-use and correctly scoped by construction: it
     * dies with the session it was issued for, and a code minted for one login
     * attempt cannot be replayed against another.
     */
    otpCodeHash: varchar('otp_code_hash', { length: 64 }),
    otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
    otpAttempts: integer('otp_attempts').notNull().default(0),
    otpSentAt: timestamp('otp_sent_at', { withTimezone: true }),

    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    /** Last password proof — sensitive actions require a recent value. */
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('company_admin_sessions_token_key').on(table.tokenHash),
    index('company_admin_sessions_admin_idx').on(table.adminId),
    index('company_admin_sessions_expires_idx').on(table.expiresAt),
  ],
);

export const companyAdminLoginAttempts = pgTable(
  'company_admin_login_attempts',
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
    index('company_admin_login_attempts_email_idx').on(table.email, table.createdAt),
    index('company_admin_login_attempts_ip_idx').on(table.ipAddress, table.createdAt),
  ],
);

