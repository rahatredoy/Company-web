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
import { homepageSectionType, navigationLocation, navigationTargetType, publishStatus } from './enums';

/**
 * CMS pages — About, Contact, policies, FAQ.
 *
 * `bodyHtml` is sanitised on write against an allow-list, so the storefront can
 * render it without becoming a script-injection surface for whoever has the
 * store admin password.
 */
export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 220 }).notNull(),
    /** Marks the page as fulfilling a known role, e.g. `privacy_policy`. */
    systemKey: varchar('system_key', { length: 40 }),
    excerpt: varchar('excerpt', { length: 500 }),
    bodyHtml: text('body_html'),
    status: publishStatus('status').notNull().default('draft'),
    showInFooter: boolean('show_in_footer').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    seoTitle: varchar('seo_title', { length: 160 }),
    seoDescription: varchar('seo_description', { length: 300 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pages_slug_key').on(table.slug),
    uniqueIndex('pages_system_key').on(table.systemKey),
    index('pages_status_idx').on(table.status, table.sortOrder),
  ],
);

export const faqs = pgTable(
  'faqs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    question: varchar('question', { length: 300 }).notNull(),
    answer: text('answer').notNull(),
    category: varchar('category', { length: 60 }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('faqs_active_idx').on(table.isActive, table.sortOrder)],
);

/**
 * The homepage builder's output.
 *
 * `type` is a closed enum and `config` is read through a per-type schema, so the
 * storefront renders only section shapes it recognises — an unknown or malformed
 * section is skipped, never executed.
 */
export const homepageSections = pgTable(
  'homepage_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: homepageSectionType('type').notNull(),
    title: varchar('title', { length: 200 }),
    subtitle: varchar('subtitle', { length: 300 }),
    /** Type-specific settings: product ids, category ids, image urls, limits. */
    config: jsonb('config').$type<Record<string, unknown>>(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('homepage_sections_order_idx').on(table.isEnabled, table.sortOrder)],
);

export const navigationMenus = pgTable(
  'navigation_menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 80 }).notNull(),
    location: navigationLocation('location').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('navigation_menus_location_idx').on(table.location, table.isActive)],
);

export const navigationItems = pgTable(
  'navigation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => navigationMenus.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    label: varchar('label', { length: 80 }).notNull(),
    targetType: navigationTargetType('target_type').notNull().default('url'),
    /** Page id, category id, or a relative path — resolved by `targetType`. */
    targetValue: varchar('target_value', { length: 400 }).notNull(),
    opensInNewTab: boolean('opens_in_new_tab').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('navigation_items_menu_idx').on(table.menuId, table.sortOrder),
    index('navigation_items_parent_idx').on(table.parentId),
  ],
);
