import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Created by company provisioning, not by us — modelled here so the commerce
 * API can read and update it with type safety. Migration 0000 uses
 * `CREATE TABLE IF NOT EXISTS` for this table for exactly that reason.
 */
export const storeSettings = pgTable(
  'store_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: varchar('tenant_ref', { length: 24 }).notNull(),
    storeName: varchar('store_name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 40 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    language: varchar('language', { length: 8 }).notNull().default('en'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    storefrontTemplate: varchar('storefront_template', { length: 40 }).notNull().default('modern-shop'),
    storefrontUrl: text('storefront_url'),
    adminUrl: text('admin_url'),
    planCode: varchar('plan_code', { length: 40 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),

    // --- added by the commerce platform ------------------------------------
    businessName: varchar('business_name', { length: 160 }),
    businessEmail: varchar('business_email', { length: 254 }),
    businessPhone: varchar('business_phone', { length: 24 }),
    businessAddress: text('business_address'),
    logoUrl: text('logo_url'),
    faviconUrl: text('favicon_url'),
    /** Tax, customer-classification thresholds and other tunables. */
    preferences: jsonb('preferences').$type<{
      taxEnabled?: boolean;
      defaultTaxRate?: number;
      pricesIncludeTax?: boolean;
      lowStockThreshold?: number;
      repeatMinOrders?: number;
      vipMinOrders?: number;
      highValueMinSpend?: number;
    }>(),
    seoTitle: varchar('seo_title', { length: 160 }),
    seoDescription: varchar('seo_description', { length: 300 }),
    socialImageUrl: text('social_image_url'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('store_settings_tenant_ref_key').on(table.tenantRef)],
);

/** Also company-provisioned. Holds our schema-version marker. */
export const platformSync = pgTable(
  'platform_sync',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 64 }).notNull(),
    value: jsonb('value').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('platform_sync_key_key').on(table.key)],
);

/** Storefront appearance. Authoritative over the seeded `storefront_template`. */
export const storefrontSettings = pgTable('storefront_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateKey: varchar('template_key', { length: 40 }).notNull().default('modern_shop'),
  colorThemeKey: varchar('color_theme_key', { length: 40 }).notNull().default('royal_blue'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  /** Section order and per-section config for the homepage builder. */
  homepageConfiguration: jsonb('homepage_configuration').$type<Record<string, unknown>>(),
  headerConfiguration: jsonb('header_configuration').$type<Record<string, unknown>>(),
  footerConfiguration: jsonb('footer_configuration').$type<Record<string, unknown>>(),
  /** Draft values live here until Save & Publish copies them across. */
  draftTemplateKey: varchar('draft_template_key', { length: 40 }),
  draftColorThemeKey: varchar('draft_color_theme_key', { length: 40 }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
