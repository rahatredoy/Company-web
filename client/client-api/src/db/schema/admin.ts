import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { adminRoleKey, adminStatus, adminTokenPurpose, securityEventType } from './enums';

/**
 * The store's one admin user.
 *
 * This is the **same table** company provisioning seeds (`store_admins`), not a
 * parallel one — the row it creates (`role='owner'`, `status='active'`, and the
 * password hash from the account the store was registered with) is the only
 * account that can ever sign into this panel. Migration 0000 therefore uses
 * `CREATE TABLE IF NOT EXISTS` plus `ADD COLUMN IF NOT EXISTS` for everything
 * below the provisioned columns.
 *
 * A second row is impossible: `store_admins_singleton_key` (migration 0002, and
 * the company bootstrap schema for new stores) is a unique index on a constant.
 * The panel has no route that creates an admin, and this is the backstop that
 * keeps it that way.
 */
export const storeAdmins = pgTable(
  'store_admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    /** Provisioned as the free-text 'owner'; normalised to a role key on first boot. */
    role: varchar('role', { length: 20 }).notNull().default('owner'),
    status: varchar('status', { length: 20 }).notNull().default('invited'),
    passwordHash: text('password_hash'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    // --- added by the commerce platform --------------------------------------
    roleKey: adminRoleKey('role_key').notNull().default('STORE_ADMIN'),
    accountStatus: adminStatus('account_status').notNull().default('invited'),
    phone: varchar('phone', { length: 24 }),
    avatarUrl: text('avatar_url'),

    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretEncrypted: text('mfa_secret_encrypted'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),

    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 64 }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('store_admins_role_idx').on(table.roleKey),
    index('store_admins_status_idx').on(table.accountStatus),
  ],
);

/** The two fixed roles. `is_system` rows cannot be renamed or deleted. */
export const adminRoles = pgTable(
  'admin_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: adminRoleKey('key').notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    description: varchar('description', { length: 200 }),
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('admin_roles_key_key').on(table.key)],
);

/** Catalogue of permission keys, seeded from `lib/constants.ts`. */
export const adminPermissions = pgTable(
  'admin_permissions',
  {
    key: varchar('key', { length: 60 }).primaryKey(),
    groupName: varchar('group_name', { length: 40 }).notNull(),
    label: varchar('label', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('admin_permissions_group_idx').on(table.groupName, table.sortOrder)],
);

/** Baseline grant for a role — what a newly created admin starts with. */
export const adminRolePermissions = pgTable(
  'admin_role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => adminRoles.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 60 })
      .notNull()
      .references(() => adminPermissions.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })],
);

/**
 * The effective grant for one admin. A `STORE_SUPER_ADMIN` bypasses this table
 * entirely — their access is implicit and cannot be revoked by editing rows.
 */
export const adminUserPermissions = pgTable(
  'admin_user_permissions',
  {
    adminId: uuid('admin_id')
      .notNull()
      .references(() => storeAdmins.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 60 })
      .notNull()
      .references(() => adminPermissions.key, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by'),
  },
  (table) => [primaryKey({ columns: [table.adminId, table.permissionKey] })],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => storeAdmins.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** Pinned at sign-in; a mismatch with the request host is a hard 403. */
    tenantRef: varchar('tenant_ref', { length: 24 }).notNull(),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    remember: boolean('remember').notNull().default(false),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    /** Last password/MFA proof — sensitive actions require a recent value. */
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_key').on(table.tokenHash),
    index('admin_sessions_admin_idx').on(table.adminId),
    index('admin_sessions_expires_idx').on(table.expiresAt),
  ],
);

export const adminLoginAttempts = pgTable(
  'admin_login_attempts',
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
    index('admin_login_attempts_email_idx').on(table.email, table.createdAt),
    index('admin_login_attempts_ip_idx').on(table.ipAddress, table.createdAt),
  ],
);

/** Single-use, hashed, self-expiring. Password reset is the only purpose left. */
export const adminPasswordResetTokens = pgTable(
  'admin_password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => storeAdmins.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    purpose: adminTokenPurpose('purpose').notNull().default('password_reset'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: varchar('requested_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_password_reset_tokens_hash_key').on(table.tokenHash),
    index('admin_password_reset_tokens_admin_idx').on(table.adminId),
  ],
);

/** MFA break-glass. Stored hashed, burned on first use. */
export const adminRecoveryCodes = pgTable(
  'admin_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => storeAdmins.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_recovery_codes_hash_key').on(table.codeHash),
    index('admin_recovery_codes_admin_idx').on(table.adminId),
  ],
);

export const adminSecurityEvents = pgTable(
  'admin_security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => storeAdmins.id, { onDelete: 'set null' }),
    type: securityEventType('type').notNull(),
    description: varchar('description', { length: 200 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_security_events_created_idx').on(table.createdAt)],
);

/**
 * Append-only trail of every meaningful admin action. Nothing in the API
 * updates or deletes a row here.
 */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => storeAdmins.id, { onDelete: 'set null' }),
    adminLabel: varchar('admin_label', { length: 254 }),
    action: varchar('action', { length: 64 }).notNull(),
    module: varchar('module', { length: 40 }).notNull(),
    entity: varchar('entity', { length: 40 }),
    entityId: varchar('entity_id', { length: 64 }),
    entityLabel: varchar('entity_label', { length: 200 }),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_logs_created_idx').on(table.createdAt),
    index('admin_audit_logs_module_idx').on(table.module, table.createdAt),
    index('admin_audit_logs_entity_idx').on(table.entity, table.entityId),
  ],
);
