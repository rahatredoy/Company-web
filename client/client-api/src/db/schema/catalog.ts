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
import { attributeInputType, mediaType, productSellBy, productStatus, productType } from './enums';

/** Self-referencing tree. Depth is not enforced in SQL — the API refuses cycles. */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 140 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    showInMenu: boolean('show_in_menu').notNull().default(true),
    /**
     * Leads the storefront navigation. A different question from `showInMenu`
     * (may it appear at all) and from `isActive` (may a shopper see it at all),
     * so it is its own column rather than a rank baked into `sortOrder`.
     */
    isFeatured: boolean('is_featured').notNull().default(false),
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
    isActive: boolean('is_active').notNull().default(true),
    isFeatured: boolean('is_featured').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('brands_slug_key').on(table.slug),
    index('brands_active_idx').on(table.isActive, table.name),
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

    description: text('description'),

    /** Denormalised from the default variant so listing queries stay one join. */
    priceFrom: numeric('price_from', { precision: 12, scale: 2 }),
    salePriceFrom: numeric('sale_price_from', { precision: 12, scale: 2 }),

    isFeatured: boolean('is_featured').notNull().default(false),
    isNewArrival: boolean('is_new_arrival').notNull().default(false),

    /**
     * One optional clip, beside the gallery rather than in it.
     *
     * `product_media` can hold a `video` row, but the gallery is written as a
     * whole list of images and reordered as one — a video mixed into it would be
     * dragged around as though it were a thumbnail and dropped by any client
     * that only sends images back. A product has at most one, so it is a column.
     */
    videoUrl: text('video_url'),

    /**
     * Whether stock decides what may be sold.
     *
     * Off means the shop keeps counting units but never refuses a sale on them —
     * made-to-order, digital, or a line the owner restocks faster than the panel
     * can be updated. It is **not** the same as having no `inventory_levels`
     * rows: an untracked product can still have a count worth reading, and a
     * tracked one with no rows yet is simply unmeasured. Both read as sellable,
     * for different reasons, and the storefront and checkout honour both.
     */
    trackInventory: boolean('track_inventory').notNull().default(true),

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

    /**
     * Sold one at a time, or weighed out.
     *
     * `measure` turns the price into a rate and lets the shopper choose how much
     * — the 1kg / 500gm / 250gm dropdown on a greengrocer's card. It is a switch
     * on the product rather than a product type, because everything else about
     * such a product (one variant, one price, one stock pool) is exactly a
     * `simple` product; only how a quantity is read changes. Off is the default
     * and is what every existing product stays.
     */
    sellBy: productSellBy('sell_by').notNull().default('unit'),

    /**
     * The unit stock and every quantity is counted in, when `sell_by = measure`.
     *
     * Always the small one — `g`, `ml`, `pc` — so `inventory_levels.available`
     * and `order_items.quantity` stay the integers they already are and nothing
     * downstream of them had to change. A shop with 40kg of pumpkin reads 40000.
     */
    measureUnit: varchar('measure_unit', { length: 8 }),

    /**
     * How many base units the shelf price buys. 1000 = the price is per kilo.
     *
     * The price column is untouched by this feature: `price_from` and the
     * variant's `price` mean "the cost of `pricing_measure` base units", and one
     * option's price is derived from that in `lib/measure.ts#priceForMeasure` —
     * rounded once, so a kilo costs the same bought whole as bought in tenths.
     */
    pricingMeasure: integer('pricing_measure'),

    /** Printed after the price: "Per 1kg", "Per 100g", "Per Piece". */
    pricingLabel: varchar('pricing_label', { length: 24 }),

    /**
     * Floor on a line's *total* measure, in base units — the "(Min. 350gm)" on
     * the card. A floor on the total rather than on the option is what lets a
     * shop offer 100gm and still refuse to weigh out less than 350gm of it.
     */
    minMeasure: integer('min_measure'),

    /**
     * The measures a shopper may pick, biggest first.
     *
     * Null means "use the store's default list" (`store_settings.preferences.
     * measureOptions`), which is why it is nullable rather than seeded: a shop
     * that sells fifty vegetables the same four ways sets the list once, and a
     * product that needs its own says so here. A list, not a step, because
     * 1kg/500gm/250gm/100gm is what a shopper recognises and 50g increments up
     * to a kilo is a dropdown with twenty rows in it.
     */
    measureOptions: jsonb('measure_options').$type<{ label: string; measure: number }[]>(),

    seoTitle: varchar('seo_title', { length: 160 }),
    seoDescription: varchar('seo_description', { length: 300 }),

    /**
     * The owner's own note on this product — a supplier, a reorder reminder, why
     * the price is what it is. **Private**: written only by `PUT /products/:id/
     * note` and returned only by the admin detail read. Every storefront query
     * names its columns, which is what keeps this one out of a shopper's reply.
     */
    ownerNote: text('owner_note'),

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
