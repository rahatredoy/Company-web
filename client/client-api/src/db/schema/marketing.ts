import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import {
  bannerPosition,
  contactMessageStatus,
  couponStatus,
  discountScope,
  discountType,
  reviewStatus,
  subscriberStatus,
} from './enums';
import { categories, products } from './catalog';
import { customers } from './customers';
import { orders } from './orders';

/** Automatic price reductions — no code needed, applied when conditions match. */
export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 140 }).notNull(),
    type: discountType('type').notNull(),
    scope: discountScope('scope').notNull().default('order'),
    value: numeric('value', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Ceiling for a percentage discount. */
    maxDiscountAmount: numeric('max_discount_amount', { precision: 12, scale: 2 }),
    minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 2 }),
    /** Which products or categories it applies to when scope is not `order`. */
    targetIds: jsonb('target_ids').$type<string[]>(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('discounts_active_idx').on(table.isActive, table.startsAt, table.endsAt)],
);

/**
 * `usedCount` is incremented **inside the order transaction** with a conditional
 * update, so parallel redemptions of the last remaining use cannot both succeed.
 */
export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull(),
    description: varchar('description', { length: 200 }),

    type: discountType('type').notNull().default('percentage'),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    maxDiscountAmount: numeric('max_discount_amount', { precision: 12, scale: 2 }),
    minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 2 }),

    scope: discountScope('scope').notNull().default('order'),
    targetIds: jsonb('target_ids').$type<string[]>(),

    /** Null means unlimited. */
    usageLimit: integer('usage_limit'),
    perCustomerLimit: integer('per_customer_limit'),
    usedCount: integer('used_count').notNull().default(0),

    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: couponStatus('status').notNull().default('active'),
    /** Whether it can sit on top of an automatic discount. */
    isStackable: boolean('is_stackable').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coupons_code_key').on(table.code),
    index('coupons_status_idx').on(table.status, table.endsAt),
    check('coupons_used_check', sql`${table.usedCount} >= 0`),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Guest redemptions are counted per email against the per-customer limit. */
    email: varchar('email', { length: 254 }),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coupon_redemptions_order_key').on(table.couponId, table.orderId),
    index('coupon_redemptions_customer_idx').on(table.couponId, table.customerId),
    index('coupon_redemptions_email_idx').on(table.couponId, table.email),
  ],
);

/** Time-boxed sale with a countdown. Expiry is checked on read, never cached past it. */
export const flashSales = pgTable(
  'flash_sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 140 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('flash_sales_window_idx').on(table.isActive, table.startsAt, table.endsAt)],
);

export const flashSaleProducts = pgTable(
  'flash_sale_products',
  {
    flashSaleId: uuid('flash_sale_id')
      .notNull()
      .references(() => flashSales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    salePrice: numeric('sale_price', { precision: 12, scale: 2 }).notNull(),
    /** Optional cap on how many units go at the sale price. */
    quantityLimit: integer('quantity_limit'),
    soldCount: integer('sold_count').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('flash_sale_products_sale_idx').on(table.flashSaleId, table.sortOrder)],
);

/**
 * `verifiedPurchase` is decided by the server from the customer's order history.
 * A browser claiming it would be trivially forgeable, so the field is never read
 * from a request body.
 *
 * A review is a rating and the text under it — there is no headline column. An
 * optional one asked people to summarise a review they had not written yet, and
 * the rating already says at a glance what a headline was there to say.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),

    /** Snapshot, so deleting an account does not blank out the review list. */
    customerName: varchar('customer_name', { length: 140 }).notNull(),
    rating: integer('rating').notNull(),
    body: varchar('body', { length: 4000 }),

    status: reviewStatus('status').notNull().default('pending'),
    verifiedPurchase: boolean('verified_purchase').notNull().default(false),
    helpfulCount: integer('helpful_count').notNull().default(0),

    adminReply: varchar('admin_reply', { length: 2000 }),
    adminRepliedAt: timestamp('admin_replied_at', { withTimezone: true }),
    moderatedBy: uuid('moderated_by'),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reviews_product_idx').on(table.productId, table.status, table.createdAt),
    index('reviews_customer_idx').on(table.customerId),
    // One review per customer per product; editing replaces rather than adds.
    uniqueIndex('reviews_customer_product_key').on(table.productId, table.customerId),
    check('reviews_rating_check', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
  ],
);

export const reviewImages = pgTable(
  'review_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    objectKey: text('object_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_images_review_idx').on(table.reviewId)],
);

export const banners = pgTable(
  'banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 160 }),
    subtitle: varchar('subtitle', { length: 240 }),
    imageUrl: text('image_url').notNull(),
    mobileImageUrl: text('mobile_image_url'),
    linkUrl: text('link_url'),
    buttonLabel: varchar('button_label', { length: 60 }),
    position: bannerPosition('position').notNull().default('home_hero'),
    /** Restricts a `category_top` banner to one category. */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('banners_position_idx').on(table.position, table.isActive, table.sortOrder)],
);

export const newsletterSubscribers = pgTable(
  'newsletter_subscribers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    status: subscriberStatus('status').notNull().default('subscribed'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    source: varchar('source', { length: 40 }),
    /** Single-use token in the unsubscribe link; stored hashed. */
    unsubscribeTokenHash: varchar('unsubscribe_token_hash', { length: 64 }),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('newsletter_subscribers_email_key').on(table.email),
    index('newsletter_subscribers_status_idx').on(table.status),
  ],
);

export const contactMessages = pgTable(
  'contact_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 140 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    phone: varchar('phone', { length: 24 }),
    subject: varchar('subject', { length: 200 }),
    message: varchar('message', { length: 4000 }).notNull(),
    status: contactMessageStatus('status').notNull().default('new'),
    ipAddress: varchar('ip_address', { length: 64 }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contact_messages_status_idx').on(table.status, table.createdAt)],
);
