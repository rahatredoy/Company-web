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
/**
 * Whether a quantity is a count of things or an amount of something.
 *
 * `unit` is a product sold one at a time — a box of eggs, a shirt. `measure`
 * is weighed or poured: the price is a rate, the shopper picks how much, and
 * stock is counted in the small base unit. See `lib/measure.ts`.
 */
export const productSellBy = pgEnum('product_sell_by', ['unit', 'measure']);
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
/** How a discount is triggered. See `lib/discounts/rules.ts`. */
export const discountKind = pgEnum('discount_kind', [
  'coupon',
  'automatic',
  'voucher',
  'campaign',
  'bank_offer',
  'payment_offer',
]);

/** What a discount takes off. */
export const discountValueType = pgEnum('discount_value_type', [
  'percentage',
  'fixed_amount',
  'buy_x_get_y',
  'fixed_price',
  'bundle',
]);

/**
 * What the owner set. `scheduled`, `expired` and "limit reached" are not stored:
 * they are read off the clock and the counter, so a sale ends itself rather than
 * waiting for a sweep to notice.
 */
export const discountStatus = pgEnum('discount_status', ['draft', 'active', 'paused']);

/** Whether a customer was put on a discount by the owner or earned it. */
export const discountAssignmentSource = pgEnum('discount_assignment_source', ['manual', 'reward']);

export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected']);

// --- content -------------------------------------------------------------------------------------
export const navigationLocation = pgEnum('navigation_location', ['header', 'footer']);
export const navigationTargetType = pgEnum('navigation_target_type', ['page', 'category', 'url']);

// --- notifications ----------------------------------------------------------------------------------
export const notificationChannel = pgEnum('store_notification_channel', ['email', 'sms', 'whatsapp']);
export const notificationStatus = pgEnum('store_notification_status', ['queued', 'sent', 'failed']);

// --- added for the storefront phase -------------------------------------------------------------

/** A cart survives checkout as `converted` so an order can be traced back to it. */
export const cartStatus = pgEnum('cart_status', ['active', 'converted', 'abandoned']);

export const customerTokenPurpose = pgEnum('customer_token_purpose', ['password_reset', 'email_verify']);

/**
 * Sign-in providers a shopper's account can be linked to.
 *
 * An enum rather than free text because the value decides which token endpoint
 * a callback talks to; a provider nobody wrote code for must not be storable.
 */
export const customerIdentityProvider = pgEnum('customer_identity_provider', ['google']);

/** The only section types the storefront will render. Anything else is ignored. */
/**
 * Every block a homepage can carry.
 *
 * The storefront's `HomepageSectionType` is the authority here — a value it can
 * render but this enum cannot store is a section nobody is able to add, which
 * is how the first seven values ended up describing a fraction of the
 * templates' capability. The pairs that look redundant are not: `category_grid`
 * is picture cards and `category_circle` an icon rail, `product_grid` is static
 * and `product_carousel` scrolls. Section order and per-section settings live in
 * `homepage_sections.config`, never in this enum.
 */
export const homepageSectionType = pgEnum('homepage_section_type', [
  'hero',
  'category_grid',
  'category_circle',
  'product_grid',
  'product_carousel',
  'banner',
  'deal',
  'promo_trio',
  'flash_sale',
  'benefits',
  'lookbook',
  'testimonial',
  'brands',
  'text',
  'collection',
  'social_gallery',
  'recently_viewed',
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
