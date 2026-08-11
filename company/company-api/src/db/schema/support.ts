import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { clientAccounts } from './clients';
import { tenants } from './tenants';
import { supportAuthorType, supportPriority, supportTicketStatus } from './enums';

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: varchar('reference', { length: 24 }).notNull(),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    subject: varchar('subject', { length: 160 }).notNull(),
    status: supportTicketStatus('status').notNull().default('open'),
    priority: supportPriority('priority').notNull().default('normal'),
    messageCount: integer('message_count').notNull().default(1),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    lastReplyBy: supportAuthorType('last_reply_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('support_tickets_reference_key').on(table.reference),
    index('support_tickets_client_idx').on(table.clientAccountId),
    index('support_tickets_status_idx').on(table.status, table.createdAt),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorType: supportAuthorType('author_type').notNull(),
    authorName: varchar('author_name', { length: 120 }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('support_messages_ticket_idx').on(table.ticketId, table.createdAt)],
);

/** Messages from the public contact form. Not tied to an account. */
export const contactMessages = pgTable(
  'contact_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    company: varchar('company', { length: 160 }),
    message: text('message').notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contact_messages_created_idx').on(table.createdAt)],
);
