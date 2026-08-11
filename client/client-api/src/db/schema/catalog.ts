import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { attributeInputType, mediaType, productStatus, productType } from './enums';

/** Self-referencing tree. Depth is not enforced in SQL — the API refuses cycles. */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 140 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    iconUrl: text('icon_url'),
    /** Optional wide image for the category landing page. */
    bannerUrl: text('banner_url'),
    isActive: boolean('is_active').notNull().default(true),
    showInMenu: boolean('show_in_menu').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    seoTitle: varchar('seo_title', { length: 160 }),
    seoDescription: varchar('seo_description', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('categories_slug_key').on(table.slug),
    index('categories_parent_idx').on(table.parentId),
    index('categories_active_idx').on(table.isActive, table.sortOrder),
  ],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_tree',
  }),
  children: many(categories, { relationName: 'category_tree' }),
}));

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 140 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    description: text('description'),
    logoUrl: text('logo_url'),
    websiteUrl: text('website_url'),
    isActive: boolean('is_active').notNull().default(true),
    isFeatured: boolean('is_featured').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    seoTitle: varchar('seo_title', { length: 160 }),
    seoDescription: varchar('seo_description', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('brands_slug_key').on(table.slug),
    index('brands_active_idx').on(table.isActive, table.sortOrder),
  ],
);

/**
 * Variant-defining and filterable attributes — Size, Colour, Storage, Material.
 *
 * `isVariantAttribute` decides whether choosing a value picks a different
 * variant (Size) or is merely descriptive and filterable (Material).
 */
export const attributes = pgTable(
  'attributes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 90 }).notNull(),
    inputType: attributeInputType('input_type').notNull().default('select'),
    isVariantAttribute: boolean('is_variant_attribute').notNull().default(true),
    isFilterable: boolean('is_filterable').notNull().default(true),
    unit: varchar('unit', { length: 16 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('attributes_slug_key').on(table.slug)],
);

export const attributeValues = pgTable(
  'attribute_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    value: varchar('value', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    /** Swatch for `input_type = 'color'`; ignored otherwise. */
    colorHex: varchar('color_hex', { length: 9 }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('attribute_values_attr_slug_key').on(table.attributeId, table.slug),
    index('attribute_values_attr_idx').on(table.attributeId, table.sortOrder),
  ],
);

/**
 * A product is the thing a customer browses; a **variant** is the thing they buy
 * and the thing stock is counted against. A `simple` product still gets exactly
 * one variant, so pricing, stock and order lines never need two code paths.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 220 }).notNull(),
    type: productType('type').notNull().default('simple'),
    status: productStatus('status').notNull().default('draft'),

    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    shortDescription: varchar('short_description', { length: 500 }),
    description: text('description'),

    /** Denormalised from the default variant so listing queries stay one join. */
    priceFrom: numeric('price_from', { precision: 12, scale: 2 }),
    salePriceFrom: numeric('sale_price_from', { precision: 12, scale: 2 }),

    isFeatured: boolean('is_featured').notNull().default(false),
    isNewArrival: boolean('is_new_arrival').notNull().default(false),

    /** Maintained by the order pipeline; never accepted from a request body. */
    soldCount: integer('sold_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    ratingAverage: numeric('rating_average', { precision: 3, scale: 2 }).notNull().default('0'),
    ratingCount: integer('rating_count').notNull().default(0),

    /** Per-product override of the store's return window. Null uses the store's. */
    returnWindowDays: integer('return_window_days'),
    isReturnable: boolean('is_returnable').notNull().default(true),

    minOrderQuantity: integer('min_order_quantity').notNull().default(1),
    maxOrderQuantity: integer('max_order_quantity'),

    seoTitle: varchar('seo_title', { length: 160 }),
    seoDescription: varchar('seo_description', { length: 300 }),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_status_idx').on(table.status, table.publishedAt),
    index('products_category_idx').on(table.categoryId, table.status),
    index('products_brand_idx').on(table.brandId, table.status),
    index('products_featured_idx').on(table.isFeatured, table.status),
    index('products_sold_idx').on(table.soldCount),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 64 }).notNull(),
    barcode: varchar('barcode', { length: 64 }),
    /** Human label built from the chosen values, e.g. "Black / M". */
    title: varchar('title', { length: 200 }),

    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    salePrice: numeric('sale_price', { precision: 12, scale: 2 }),
    saleStartsAt: timestamp('sale_starts_at', { withTimezone: true }),
    saleEndsAt: timestamp('sale_ends_at', { withTimezone: true }),
    /** Never exposed by any storefront endpoint. */
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }),

    weightGrams: integer('weight_grams'),
    imageUrl: text('image_url'),

    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('product_variants_sku_key').on(table.sku),
    index('product_variants_product_idx').on(table.productId, table.sortOrder),
    index('product_variants_barcode_idx').on(table.barcode),
  ],
);

/** Which attribute values make up one variant. */
export const productVariantValues = pgTable(
  'product_variant_values',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    attributeValueId: uuid('attribute_value_id')
      .notNull()
      .references(() => attributeValues.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.attributeId] }),
    index('product_variant_values_value_idx').on(table.attributeValueId),
  ],
);

export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Set when the image belongs to one variant rather than the product. */
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    type: mediaType('type').notNull().default('image'),
    url: text('url').notNull(),
    /** Randomised R2 object key; the uploaded filename is never trusted. */
    objectKey: text('object_key'),
    altText: varchar('alt_text', { length: 200 }),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('product_media_product_idx').on(table.productId, table.sortOrder),
    index('product_media_variant_idx').on(table.variantId),
  ],
);

/** Free-form spec rows for the product tabs — "Screen: 6.1 inch". */
export const productSpecifications = pgTable(
  'product_specifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupName: varchar('group_name', { length: 80 }),
    label: varchar('label', { length: 120 }).notNull(),
    value: varchar('value', { length: 400 }).notNull(),
    /** Shown on the comparison table when true. */
    isKeySpec: boolean('is_key_spec').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('product_specifications_product_idx').on(table.productId, table.sortOrder)],
);

/**
 * Descriptive (non-variant) attribute values attached to a product, so a filter
 * like Material can narrow a listing without creating variants.
 */
export const productAttributeValues = pgTable(
  'product_attribute_values',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    attributeValueId: uuid('attribute_value_id')
      .notNull()
      .references(() => attributeValues.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.attributeValueId] }),
    index('product_attribute_values_value_idx').on(table.attributeValueId),
  ],
);

/** Curated "frequently bought together" pairs. Not inferred, not AI. */
export const productBundles = pgTable(
  'product_bundles',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    relatedProductId: uuid('related_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.productId, table.relatedProductId] })],
);

/**
 * Collections drive the storefront's "Shop by collection" blocks without
 * disturbing the category tree a product belongs to.
 */
export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 140 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('collections_slug_key').on(table.slug)],
);

export const collectionProducts = pgTable(
  'collection_products',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.productId] })],
);
