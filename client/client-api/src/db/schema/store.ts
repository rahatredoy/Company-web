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
      /**
       * Every language and display currency this store has switched on.
       *
       * Both live here rather than in columns of their own because they are a
       * store's own choice about its shopfront, not something the control plane
       * provisions — and a jsonb key needs no migration to appear. Absent means
       * "only the one in `language` / `currency`", which is what the storefront
       * reads as "no selector to draw".
       *
       * A currency listed here is a currency prices are quoted in, so adding a
       * second one is a pricing decision, not a display one.
       */
      languages?: string[];
      currencies?: string[];
      whatsappNumber?: string;
      whatsappEnabled?: boolean;
      /**
       * The default measure picker for products sold by weight or volume.
       *
       * Here rather than on each product because a greengrocer sells fifty
       * vegetables the same four ways — 1kg, 500gm, 250gm, 100gm — and typing
       * that list per product is how half the catalogue ends up with a different
       * one. A product may still name its own list, and `products.
       * measure_options` being null is what defers to this. See `lib/measure.ts`.
       */
      measureOptions?: { label: string; measure: number }[];
      /**
       * What happens when more than one automatic discount matches a basket:
       * the single best one, the single highest-priority one, or every one that
       * combines. Absent is `best`. See `lib/discounts/engine.ts`.
       */
      discountStrategy?: 'best' | 'priority' | 'stack';
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
