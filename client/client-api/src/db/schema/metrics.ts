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
import { notificationChannel, notificationStatus } from './enums';
import { products } from './catalog';

/**
 * Pre-aggregated per day, so a report never scans the order table.
 *
 * A store with a year of trading has a few hundred rows here rather than tens of
 * thousands of orders to sum on every dashboard load.
 */
export const storeDailyMetrics = pgTable(
  'store_daily_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    day: date('day').notNull(),
    orders: integer('orders').notNull().default(0),
    cancelledOrders: integer('cancelled_orders').notNull().default(0),
    grossSales: numeric('gross_sales', { precision: 14, scale: 2 }).notNull().default('0'),
    discounts: numeric('discounts', { precision: 14, scale: 2 }).notNull().default('0'),
    refunds: numeric('refunds', { precision: 14, scale: 2 }).notNull().default('0'),
    shipping: numeric('shipping', { precision: 14, scale: 2 }).notNull().default('0'),
    tax: numeric('tax', { precision: 14, scale: 2 }).notNull().default('0'),
    netSales: numeric('net_sales', { precision: 14, scale: 2 }).notNull().default('0'),
    newCustomers: integer('new_customers').notNull().default(0),
    returningCustomers: integer('returning_customers').notNull().default(0),
    unitsSold: integer('units_sold').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('store_daily_metrics_day_key').on(table.day)],
);

export const productDailyMetrics = pgTable(
  'product_daily_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    day: date('day').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    views: integer('views').notNull().default(0),
    addToCarts: integer('add_to_carts').notNull().default(0),
    unitsSold: integer('units_sold').notNull().default(0),
    revenue: numeric('revenue', { precision: 14, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('product_daily_metrics_key').on(table.day, table.productId),
    index('product_daily_metrics_product_idx').on(table.productId, table.day),
  ],
);

/** Customer-facing transactional email bodies, editable by the store. */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable identifier the code sends against, e.g. `order_confirmed`. */
    key: varchar('key', { length: 60 }).notNull(),
    channel: notificationChannel('channel').notNull().default('email'),
    subject: varchar('subject', { length: 200 }),
    body: text('body'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** Placeholders the editor offers, e.g. {{orderNumber}}. */
    availableVariables: jsonb('available_variables').$type<string[]>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('notification_templates_key').on(table.key, table.channel)],
);

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateKey: varchar('template_key', { length: 60 }),
    channel: notificationChannel('channel').notNull().default('email'),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    subject: varchar('subject', { length: 200 }),
    status: notificationStatus('status').notNull().default('queued'),
    error: text('error'),
    referenceType: varchar('reference_type', { length: 32 }),
    referenceId: varchar('reference_id', { length: 64 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_logs_created_idx').on(table.createdAt),
    index('notification_logs_reference_idx').on(table.referenceType, table.referenceId),
  ],
);
