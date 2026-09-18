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
  discountAssignmentSource,
  discountKind,
  discountStatus,
  discountValueType,
  reviewStatus,
} from './enums';
import type {
  AreaRules,
  CardPrefix,
  CombinationRules,
  CustomerRules,
  IssueRules,
  PaymentRules,
  ProductRules,
  PurchaseRules,
  RewardRules,
  ScheduleRules,
} from '../../lib/discounts/rules';
import { categories, products } from './catalog';
import { customers } from './customers';
import { orders } from './orders';

/**
 * Every discount a store runs — a code, an automatic offer, a voucher, a bank
 * or payment offer — as one row of rules and one action.
 *
 * The scalar parts a list filters by or a checkout narrows on are columns; the
 * set-shaped rules are jsonb groups whose shape is `lib/discounts/rules.ts`,
 * parsed on the way in and read back through the same schemas. Nothing but
 * `lib/discounts/engine.ts` decides what they mean.
 *
 * `usedCount` is incremented **inside the order transaction** by a conditional
 * update that refuses to pass `usageLimit`, and decremented when an order that
 * used it is cancelled — so it is the live count of uses, and the limit check is
 * race-free rather than a read followed by a hopeful write.
 */
export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: discountKind('kind').notNull().default('coupon'),
    /** The owner's own name for it. Never shown to a shopper. */
    name: varchar('name', { length: 140 }).notNull(),
    /** Null for a discount nobody types. Unique case-insensitively (`discounts_code_key`). */
    code: varchar('code', { length: 40 }),
    /** What the shopper reads beside it. Falls back to a description of the offer. */
    title: varchar('title', { length: 200 }),
    summary: varchar('summary', { length: 400 }),
    /** Staff-only. */
    notes: varchar('notes', { length: 1000 }),

    valueType: discountValueType('value_type').notNull().default('percentage'),
    /** A percentage, an amount off, a unit price or a bundle price — `valueType` says which. */
    value: numeric('value', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Ceiling on everything this discount gives on one order. */
    maxDiscountAmount: numeric('max_discount_amount', { precision: 12, scale: 2 }),

    minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 2 }),
    minQuantity: integer('min_quantity'),
    /** How many units at most are discounted, cheapest first. */
    maxDiscountedQuantity: integer('max_discounted_quantity'),
    /** The order's subtotal may not fall below this once every discount is taken off. */
    minSubtotalAfterDiscount: numeric('min_subtotal_after_discount', { precision: 12, scale: 2 }),

    productRules: jsonb('product_rules').$type<Partial<ProductRules>>().notNull().default({}),
    purchaseRules: jsonb('purchase_rules').$type<Partial<PurchaseRules>>().notNull().default({}),
    rewardRules: jsonb('reward_rules').$type<Partial<RewardRules>>().notNull().default({}),
    customerRules: jsonb('customer_rules').$type<Partial<CustomerRules>>().notNull().default({}),
    paymentRules: jsonb('payment_rules').$type<Partial<PaymentRules>>().notNull().default({}),
    areaRules: jsonb('area_rules').$type<Partial<AreaRules>>().notNull().default({}),
    scheduleRules: jsonb('schedule_rules').$type<Partial<ScheduleRules>>().notNull().default({}),
    combinationRules: jsonb('combination_rules').$type<Partial<CombinationRules>>().notNull().default({}),
    /** Set only on a voucher that issues itself. */
    issueRules: jsonb('issue_rules').$type<IssueRules>(),

    /** Null means unlimited. */
    usageLimit: integer('usage_limit'),
    /** Lifetime uses per customer. Null means unlimited. */
    perCustomerLimit: integer('per_customer_limit'),
    usedCount: integer('used_count').notNull().default(0),
    cooldownAmount: integer('cooldown_amount'),
    cooldownUnit: varchar('cooldown_unit', { length: 8 }).$type<'day' | 'week' | 'month'>(),

    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** An IANA zone the schedule is read in. Null follows `store_settings.timezone`. */
    timezone: varchar('timezone', { length: 64 }),
    /** Lower goes first when automatic discounts are ranked. */
    priority: integer('priority').notNull().default(10),

    status: discountStatus('status').notNull().default('active'),
    /**
     * Deleted after it was used. The row stays because redemptions and orders
     * point at it and explain a past discount; it is hidden and refused.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('discounts_code_key').on(sql`upper(${table.code})`).where(sql`${table.code} is not null`),
    index('discounts_status_idx')
      .on(table.status, table.startsAt, table.endsAt)
      .where(sql`${table.archivedAt} is null`),
    index('discounts_automatic_idx')
      .on(table.priority)
      .where(sql`${table.code} is null and ${table.status} = 'active' and ${table.archivedAt} is null`),
    index('discounts_created_idx').on(table.createdAt, table.id),
    check('discounts_used_check', sql`${table.usedCount} >= 0`),
    check('discounts_value_check', sql`${table.value} >= 0`),
  ],
);

/**
 * The customers a discount names: who a "selected customers" offer is for, and
 * who holds a voucher.
 *
 * A voucher holding is **spent** — `used_at` and `order_id` are set in the
 * order transaction and cleared if that order is cancelled — which is what
 * "this voucher has already been used" is read from. `period_key` lets an
 * automatically issued voucher be issued again in a later period (a birthday
 * each year) without ever issuing twice in the same one.
 */
export const discountCustomers = pgTable(
  'discount_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discountId: uuid('discount_id')
      .notNull()
      .references(() => discounts.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    source: discountAssignmentSource('source').notNull().default('manual'),
    periodKey: varchar('period_key', { length: 16 }).notNull().default(''),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('discount_customers_period_key').on(table.discountId, table.customerId, table.periodKey),
    index('discount_customers_customer_idx').on(table.customerId, table.usedAt),
  ],
);

/**
 * One discount's part in one order.
 *
 * Written in the order transaction and never edited, except that cancelling the
 * order sets `voided_at` — which hands the use back to the usage limit, the
 * per-customer limit and the cooldown, all of which count live rows only.
 * `original_amount` and `final_amount` are the order's totals either side of
 * its discounts, so the ledger can say what a discount was worth to the order
 * without re-deriving it from rows that may since have been refunded.
 */
export const discountRedemptions = pgTable(
  'discount_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discountId: uuid('discount_id')
      .notNull()
      .references(() => discounts.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Only on redemptions from the guest-checkout era. */
    email: varchar('email', { length: 254 }),
    /** The code as it was when used; a discount's code can be edited later. */
    code: varchar('code', { length: 40 }),
    /** Everything this discount took off. */
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull(),
    /** The order subtotal, before any discount. */
    originalAmount: numeric('original_amount', { precision: 14, scale: 2 }),
    /** What the order was charged. */
    finalAmount: numeric('final_amount', { precision: 14, scale: 2 }),
    assignmentId: uuid('assignment_id').references(() => discountCustomers.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('discount_redemptions_order_key').on(table.discountId, table.orderId),
    index('discount_redemptions_customer_idx').on(table.discountId, table.customerId),
    index('discount_redemptions_email_idx').on(table.discountId, table.email),
    index('discount_redemptions_live_idx')
      .on(table.discountId, table.createdAt)
      .where(sql`${table.voidedAt} is null`),
  ],
);

/**
 * The banks a card offer can name.
 *
 * Data rather than a list in code, because which banks a shop partners with —
 * and which of their card ranges an offer covers — is the shop's business and
 * changes with every campaign. `card_prefixes` is what a card is actually matched
 * against: a shop cannot see "Islami Bank", only the first digits of the card.
 */
export const paymentBanks = pgTable(
  'payment_banks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    shortName: varchar('short_name', { length: 40 }),
    country: varchar('country', { length: 2 }).notNull().default('BD'),
    cardPrefixes: jsonb('card_prefixes').$type<CardPrefix[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('payment_banks_name_key').on(sql`lower(${table.name})`)],
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
    /**
     * Where the banner goes when it is clicked.
     *
     * A category or a subcategory — the two are one table, so a picker over it
     * offers both without the schema knowing the difference. It is the
     * destination rather than a placement restriction: `resolveBanners` turns it
     * into `/category/<slug>`, and it outranks `linkUrl`, which stays for the
     * addresses that are not a category (`/sale`, a landing page).
     *
     * `set null`, not cascade: reorganising the catalogue must cost a banner its
     * link and never its artwork. See `drizzle/0009_banner_category_link.sql`.
     */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('banners_position_idx').on(table.position, table.isActive, table.sortOrder)],
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
