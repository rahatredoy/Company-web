import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { clientAccounts } from './clients';
import { tenants } from './tenants';
import { activityType, notificationChannel, notificationStatus } from './enums';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull().default('email'),
    template: varchar('template', { length: 64 }).notNull(),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    subject: varchar('subject', { length: 200 }),
    status: notificationStatus('status').notNull().default('queued'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_client_idx').on(table.clientAccountId, table.createdAt),
    index('notifications_status_idx').on(table.status),
  ],
);

/**
 * Append-only. Nothing in the admin panel or the API can update or delete a row
 * here — the audit trail is the last line of defence.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: varchar('action', { length: 64 }).notNull(),
    actorType: varchar('actor_type', { length: 20 }).notNull().default('admin'),
    actorId: uuid('actor_id'),
    actorLabel: varchar('actor_label', { length: 254 }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, { onDelete: 'set null' }),
    targetLabel: varchar('target_label', { length: 200 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 64 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_action_idx').on(table.action, table.createdAt),
    index('audit_logs_tenant_idx').on(table.tenantId),
    index('audit_logs_created_idx').on(table.createdAt),
  ],
);

/** Feed shown on the admin dashboard and on a client's Activity tab. */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: activityType('type').notNull(),
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 160 }).notNull(),
    subject: varchar('subject', { length: 160 }).notNull(),
    metadata: jsonb('metadata'),
    /** Set when the company admin acknowledges the event in the bell feed. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('activity_events_created_idx').on(table.createdAt),
    index('activity_events_client_idx').on(table.clientAccountId, table.createdAt),
    index('activity_events_unread_idx').on(table.readAt, table.createdAt),
  ],
);

/** Key/value settings editable from the admin panel. Secrets never live here. */
export const systemSettings = pgTable(
  'system_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 64 }).notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('system_settings_key_key').on(table.key)],
);
