import { pgEnum } from 'drizzle-orm/pg-core';

// --- store admin ---------------------------------------------------------------
export const adminRoleKey = pgEnum('admin_role_key', ['STORE_SUPER_ADMIN', 'STORE_ADMIN']);

/**
 * Provisioning seeds `active` — the admin arrives with the password its owner
 * registered with. `invited` only survives for stores provisioned before that
 * and is treated as "cannot sign in".
 */
export const adminStatus = pgEnum('admin_status', ['invited', 'active', 'disabled']);

/**
 * `claim` is retired — nothing issues it any more. The value stays because
 * removing a Postgres enum member means recreating the type in every tenant
 * database, which buys nothing.
 */
export const adminTokenPurpose = pgEnum('admin_token_purpose', ['claim', 'password_reset']);

/** `account_claimed` is retired too, but old audit rows still carry it. */
export const securityEventType = pgEnum('security_event_type', [
  'login_success',
  'login_failed',
  'logout',
  'account_claimed',
  'password_changed',
  'password_reset_requested',
  'mfa_enabled',
  'mfa_disabled',
  'recovery_codes_regenerated',
  'session_revoked',
  'permission_changed',
  'staff_created',
  'staff_disabled',
]);

// --- catalog ---------------------------------------------------------------------
export const productStatus = pgEnum('product_status', ['draft', 'active', 'inactive']);
export const productType = pgEnum('product_type', ['simple', 'variable']);
export const publishStatus = pgEnum('publish_status', ['draft', 'published']);
export const mediaType = pgEnum('media_type', ['image', 'video']);

// --- inventory ---------------------------------------------------------------------
export const inventoryBucket = pgEnum('inventory_bucket', [
  'available',
  'reserved',
  'return_pending',
  'damaged',
  'incoming',
]);

export const inventoryTransactionType = pgEnum('inventory_transaction_type', [
  'initial',
  'adjustment',
  'order_reserved',
  'order_released',
  'order_fulfilled',
  'return_received',
  'return_restocked',
  'damaged',
  'repaired',
  'disposed',
  'received',
  'transfer',
]);

export const damageReason = pgEnum('damage_reason', [
  'customer_return',
  'shipping_damage',
  'warehouse_damage',
  'manufacturing_defect',
  'expired',
  'missing_parts',
  'other',
]);

// --- orders ---------------------------------------------------------------------------
export const orderStatus = pgEnum('order_status', [
  'new',
  'pending',
  'confirmed',
  'processing',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'refunded',
  'failed',
]);

export const paymentStatus = pgEnum('order_payment_status', [
  'pending',
  'paid',
  'failed',
  'partially_paid',
  'refunded',
  'partially_refunded',
  'cod_pending',
]);

export const shippingStatus = pgEnum('shipping_status', [
  'not_shipped',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'returned',
]);

export const addressType = pgEnum('address_type', ['shipping', 'billing']);

// --- customers ---------------------------------------------------------------------------
export const customerStatus = pgEnum('customer_status', ['active', 'blocked']);
export const customerType = pgEnum('customer_type', ['new', 'repeat', 'vip', 'high_value']);

// --- returns & refunds ----------------------------------------------------------------------
export const returnStatus = pgEnum('return_status', [
  'requested',
  'under_review',
  'approved',
  'rejected',
  'received',
  'inspected',
  'completed',
]);

export const returnResolution = pgEnum('return_resolution', ['refund', 'exchange', 'replacement']);

export const inspectionResult = pgEnum('inspection_result', ['good', 'damaged', 'repairable', 'rejected']);

export const refundStatus = pgEnum('refund_status', [
  'requested',
  'approved',
  'rejected',
  'processing',
  'completed',
  'failed',
]);

// --- marketing --------------------------------------------------------------------------------
export const discountType = pgEnum('discount_type', [
  'percentage',
  'fixed',
  'free_shipping',
  'buy_x_get_y',
]);

export const discountScope = pgEnum('discount_scope', ['order', 'product', 'category']);
export const couponStatus = pgEnum('coupon_status', ['active', 'scheduled', 'expired', 'disabled']);
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected']);

// --- content -------------------------------------------------------------------------------------
export const navigationLocation = pgEnum('navigation_location', ['header', 'footer']);
export const navigationTargetType = pgEnum('navigation_target_type', ['page', 'category', 'url']);
export const subscriberStatus = pgEnum('subscriber_status', ['subscribed', 'unsubscribed']);

// --- notifications ----------------------------------------------------------------------------------
export const notificationChannel = pgEnum('store_notification_channel', ['email', 'sms', 'whatsapp']);
export const notificationStatus = pgEnum('store_notification_status', ['queued', 'sent', 'failed']);

// --- added for the storefront phase -------------------------------------------------------------

/** A cart survives checkout as `converted` so an order can be traced back to it. */
export const cartStatus = pgEnum('cart_status', ['active', 'converted', 'abandoned']);

export const customerTokenPurpose = pgEnum('customer_token_purpose', ['password_reset', 'email_verify']);

/** The only section types the storefront will render. Anything else is ignored. */
export const homepageSectionType = pgEnum('homepage_section_type', [
  'hero',
  'category_grid',
  'product_grid',
  'banner',
  'brands',
  'newsletter',
  'text',
]);

export const bannerPosition = pgEnum('banner_position', [
  'home_hero',
  'home_promo',
  'category_top',
  'sidebar',
  'popup',
]);

/** `cod` and `mock` are live; the rest are adapters waiting to be configured. */
export const paymentProvider = pgEnum('payment_provider', ['cod', 'mock', 'stripe', 'sslcommerz']);

export const paymentTransactionStatus = pgEnum('payment_transaction_status', [
  'pending',
  'authorized',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
]);

export const backInStockStatus = pgEnum('back_in_stock_status', ['pending', 'notified', 'cancelled']);

export const contactMessageStatus = pgEnum('contact_message_status', ['new', 'read', 'replied', 'archived']);

/** Which side of the catalogue an attribute drives. */
export const attributeInputType = pgEnum('attribute_input_type', ['select', 'color', 'text', 'number']);
