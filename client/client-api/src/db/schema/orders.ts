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
import { addressType, orderStatus, paymentStatus, shippingStatus } from './enums';
import { productVariants, products } from './catalog';
import { customers } from './customers';

/**
 * An order is a **snapshot**, not a set of pointers.
 *
 * Product names, prices and addresses are copied in at the moment of purchase,
 * so renaming a product, changing its price or deleting an address can never
 * rewrite what a customer was actually charged. Every money column here is
 * written by the server from its own arithmetic — nothing arrives from a
 * browser.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Customer-facing, readable, non-sequential in appearance: ORD-20260810-0042. */
    orderNumber: varchar('order_number', { length: 32 }).notNull(),

    /** Null for a guest order — the contact fields below carry the identity. */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    email: varchar('email', { length: 254 }).notNull(),
    phone: varchar('phone', { length: 24 }),
    customerName: varchar('customer_name', { length: 140 }).notNull(),

    status: orderStatus('status').notNull().default('new'),
    paymentStatus: paymentStatus('payment_status').notNull().default('pending'),
    shippingStatus: shippingStatus('shipping_status').notNull().default('not_shipped'),

    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    discountTotal: numeric('discount_total', { precision: 14, scale: 2 }).notNull().default('0'),
    taxTotal: numeric('tax_total', { precision: 14, scale: 2 }).notNull().default('0'),
    shippingTotal: numeric('shipping_total', { precision: 14, scale: 2 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 14, scale: 2 }).notNull().default('0'),
    /** Sum of completed refunds. Caps any further refund. */
    refundedTotal: numeric('refunded_total', { precision: 14, scale: 2 }).notNull().default('0'),

    couponCode: varchar('coupon_code', { length: 40 }),
    couponId: uuid('coupon_id'),

    paymentProvider: varchar('payment_provider', { length: 24 }),
    paymentMethodLabel: varchar('payment_method_label', { length: 60 }),

    shippingMethodId: uuid('shipping_method_id'),
    shippingMethodLabel: varchar('shipping_method_label', { length: 80 }),
    estimatedDeliveryAt: timestamp('estimated_delivery_at', { withTimezone: true }),

    customerNote: varchar('customer_note', { length: 500 }),
    /** Staff-only. Never returned by a customer endpoint. */
    adminNote: text('admin_note'),

    cancelReason: varchar('cancel_reason', { length: 200 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** Whether the reservation has been handed back to `available`. */
    inventoryReleased: boolean('inventory_released').notNull().default(false),

    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    ipAddress: varchar('ip_address', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_number_key').on(table.orderNumber),
    index('orders_customer_idx').on(table.customerId, table.placedAt),
    index('orders_status_idx').on(table.status, table.placedAt),
    index('orders_payment_status_idx').on(table.paymentStatus),
    index('orders_email_idx').on(table.email),
    index('orders_placed_idx').on(table.placedAt),
    check('orders_totals_check', sql`${table.grandTotal} >= 0 AND ${table.refundedTotal} >= 0`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    /** Kept for reporting; the snapshot below is what the customer sees. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),

    productName: varchar('product_name', { length: 200 }).notNull(),
    variantTitle: varchar('variant_title', { length: 200 }),
    sku: varchar('sku', { length: 64 }),
    imageUrl: text('image_url'),
    /** The chosen attribute values, frozen: {"Colour":"Black","Size":"M"}. */
    attributes: jsonb('attributes').$type<Record<string, string>>(),

    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    /** What was actually charged per unit after any sale price. */
    unitSalePrice: numeric('unit_sale_price', { precision: 12, scale: 2 }),
    quantity: integer('quantity').notNull(),

    /**
     * Which measure was bought, frozen like every other snapshot on this line.
     *
     * Null for an ordinary product, and that is the reading everything downstream
     * takes: `quantity` alone means "three of them". For a product sold by
     * measure it means "three of `measure_label`", and `measure` is how much of
     * the base unit one of them is — so a line for 2 x 500gm is quantity 2,
     * measure 500, and the kilo it took off the shelf is the product of the two.
     *
     * Both are stored rather than derived from the product, because the product's
     * option list is editable and a receipt has to keep saying what was sold.
     */
    measureLabel: varchar('measure_label', { length: 24 }),
    measure: integer('measure'),

    lineDiscount: numeric('line_discount', { precision: 12, scale: 2 }).notNull().default('0'),
    lineTax: numeric('line_tax', { precision: 12, scale: 2 }).notNull().default('0'),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),

    /** How many units of this line have been returned and accepted. */
    returnedQuantity: integer('returned_quantity').notNull().default(0),
    warehouseId: uuid('warehouse_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    index('order_items_product_idx').on(table.productId),
    check('order_items_quantity_check', sql`${table.quantity} > 0`),
    check('order_items_returned_check', sql`${table.returnedQuantity} >= 0 AND ${table.returnedQuantity} <= ${table.quantity}`),
  ],
);

/** Frozen copy of where the order was going, so editing an address never rewrites history. */
export const orderAddresses = pgTable(
  'order_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: addressType('type').notNull(),
    fullName: varchar('full_name', { length: 140 }).notNull(),
    phone: varchar('phone', { length: 24 }).notNull(),
    addressLine1: varchar('address_line1', { length: 200 }).notNull(),
    addressLine2: varchar('address_line2', { length: 200 }),
    city: varchar('city', { length: 80 }).notNull(),
    state: varchar('state', { length: 80 }),
    postalCode: varchar('postal_code', { length: 20 }),
    country: varchar('country', { length: 80 }).notNull(),
  },
  (table) => [uniqueIndex('order_addresses_order_type_key').on(table.orderId, table.type)],
);

/** Append-only. Drives the customer-facing order timeline. */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    note: varchar('note', { length: 300 }),
    /** Null when the customer or the payment webhook caused the change. */
    adminId: uuid('admin_id'),
    adminLabel: varchar('admin_label', { length: 254 }),
    /** False for internal steps the customer should not be shown. */
    isCustomerVisible: boolean('is_customer_visible').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('order_status_history_order_idx').on(table.orderId, table.createdAt)],
);
