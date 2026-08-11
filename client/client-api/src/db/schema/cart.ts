import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { cartStatus } from './enums';
import { productVariants, products } from './catalog';
import { customers } from './customers';

/**
 * Carts live on the server, for guests too.
 *
 * A guest cart is reached by an opaque token in an HttpOnly cookie, so the
 * browser holds an identifier and nothing else — no prices, no totals, nothing
 * a devtools console could edit into a cheaper order. Signing in merges the
 * guest cart into the customer's.
 */
export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the guest cookie token. Null once the cart has an owner. */
    tokenHash: varchar('token_hash', { length: 64 }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    status: cartStatus('status').notNull().default('active'),

    /** Held as text so an invalid code can be shown back without a join. */
    couponCode: varchar('coupon_code', { length: 40 }),
    note: varchar('note', { length: 500 }),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),

    /** Set when checkout converts the cart, for order-to-cart tracing. */
    convertedOrderId: uuid('converted_order_id'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('carts_token_key').on(table.tokenHash),
    index('carts_customer_idx').on(table.customerId, table.status),
    index('carts_activity_idx').on(table.status, table.lastActivityAt),
  ],
);

/**
 * A line holds only what the customer chose. Price is deliberately **not**
 * stored: every read re-resolves the current price from the variant, so a cart
 * left open across a price change cannot check out at the stale figure.
 */
export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cart_items_cart_variant_key').on(table.cartId, table.variantId),
    index('cart_items_cart_idx').on(table.cartId),
    check('cart_items_quantity_check', sql`${table.quantity} > 0`),
  ],
);

export const wishlists = pgTable(
  'wishlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull().default('My wishlist'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('wishlists_customer_key').on(table.customerId, table.name)],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wishlistId: uuid('wishlist_id')
      .notNull()
      .references(() => wishlists.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('wishlist_items_unique').on(table.wishlistId, table.productId, table.variantId),
    index('wishlist_items_product_idx').on(table.productId),
  ],
);
