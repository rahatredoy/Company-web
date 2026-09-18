/** Cookie name is distinct from every company-side cookie — audiences never overlap. */
export const SESSION_COOKIE = {
  admin: 'store_admin_session',
  adminMfa: 'store_admin_mfa',
  /**
   * The shopper's session — a fourth cookie family that interoperates with none
   * of the others.
   *
   * A customer is the least-trusted principal on the platform and holds no
   * permissions at all, so their token must never be mistakable for a store
   * admin's. Distinct names are what make that true at the browser rather than
   * relying on the table lookup to fail.
   */
  customer: 'store_customer_session',
  /**
   * Names the orders a browser placed as a guest.
   *
   * Not a credential and not a session: it authorises reading the confirmation
   * page for orders this browser actually created, and nothing else. Without it
   * a guest who has just paid is bounced off their own receipt.
   */
  guestOrders: 'store_guest_orders',
} as const;

/**
 * The `aud` claim on every session JWT this API issues.
 *
 * A company-admin or company-client token can never authenticate here, and none
 * of these can authenticate there — different secrets as well as different
 * audiences. Each principal gets one of its own rather than a flag inside a
 * shared audience: `verifyJwt` is handed the single value it will accept, so an
 * unfinished MFA challenge or a shopper's token presented to a store-admin route
 * does not merely fail a check further in, it fails to verify at all.
 */
export const AUTH_AUDIENCE = {
  admin: 'commerce-admin',
  adminMfa: 'commerce-admin-mfa',
  customer: 'commerce-customer',
} as const;

export const STORE_ROLES = {
  superAdmin: 'STORE_SUPER_ADMIN',
  admin: 'STORE_ADMIN',
} as const;

export type StoreRole = (typeof STORE_ROLES)[keyof typeof STORE_ROLES];

/**
 * Stable permission keys. `STORE_SUPER_ADMIN` implicitly holds all of them;
 * `STORE_ADMIN` holds only what has been granted. Enforced in Fastify — hiding
 * a button in the UI is not authorisation.
 */
export const PERMISSIONS = [
  'dashboard.view',

  'products.view',
  'products.create',
  'products.update',
  'products.delete',

  'categories.view',
  'categories.manage',

  'brands.view',
  'brands.manage',

  'attributes.view',
  'attributes.manage',

  'inventory.view',
  'inventory.adjust',

  'orders.view',
  'orders.update',
  'orders.cancel',

  'customers.view',
  'customers.update',

  'returns.view',
  'returns.approve',
  'returns.reject',

  'refunds.view',
  'refunds.approve',

  'reviews.view',
  'reviews.manage',

  'marketing.view',
  'marketing.manage',

  'website.view',
  'website.manage',

  'settings.view',
  'settings.update',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Grouped for the roles & permissions UI. */
export const PERMISSION_GROUPS: { group: string; permissions: Permission[] }[] = [
  { group: 'Dashboard', permissions: ['dashboard.view'] },
  { group: 'Products', permissions: ['products.view', 'products.create', 'products.update', 'products.delete'] },
  { group: 'Catalog', permissions: ['categories.view', 'categories.manage', 'brands.view', 'brands.manage', 'attributes.view', 'attributes.manage'] },
  { group: 'Inventory', permissions: ['inventory.view', 'inventory.adjust'] },
  { group: 'Orders', permissions: ['orders.view', 'orders.update', 'orders.cancel'] },
  { group: 'Customers', permissions: ['customers.view', 'customers.update'] },
  { group: 'Returns', permissions: ['returns.view', 'returns.approve', 'returns.reject'] },
  { group: 'Refunds', permissions: ['refunds.view', 'refunds.approve'] },
  { group: 'Reviews', permissions: ['reviews.view', 'reviews.manage'] },
  { group: 'Marketing', permissions: ['marketing.view', 'marketing.manage'] },
  { group: 'Website', permissions: ['website.view', 'website.manage'] },
  { group: 'Settings', permissions: ['settings.view', 'settings.update'] },
];

/** Sensible starting grant for a newly created STORE_ADMIN. */
export const DEFAULT_STORE_ADMIN_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'products.view',
  'categories.view',
  'brands.view',
  'attributes.view',
  'inventory.view',
  'orders.view',
  'customers.view',
  'returns.view',
  'refunds.view',
  'reviews.view',
  'marketing.view',
  'website.view',
];

/** Storefront templates — underscore keys, authoritative in `storefront_settings`. */
export const STOREFRONT_TEMPLATES = [
  'marketplace',
  'modern_shop',
  'fashion_boutique',
  'minimal_store',
  'electronics',
  'lifestyle',
] as const;

export type StorefrontTemplate = (typeof STOREFRONT_TEMPLATES)[number];
export const DEFAULT_TEMPLATE: StorefrontTemplate = 'modern_shop';

/**
 * Eight themes. Any template may use any theme — 6 x 8 = 48 valid combinations —
 * because a theme only ever redefines CSS custom properties and never touches
 * layout. The palettes themselves live in the storefront (`src/themes/`); this
 * list is what the API validates against.
 */
export const COLOR_THEMES = [
  'royal_blue',
  'emerald_green',
  'luxury_black',
  'rose_pink',
  'modern_purple',
  'sunset_orange',
  'midnight_navy',
  'olive_premium',
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];
export const DEFAULT_THEME: ColorTheme = 'royal_blue';

/** Unknown/legacy theme keys fall back rather than rendering an unstyled page. */
export function normaliseThemeKey(value: string | null | undefined): ColorTheme {
  const key = (value ?? '').replace(/-/g, '_');
  return (COLOR_THEMES as readonly string[]).includes(key) ? (key as ColorTheme) : DEFAULT_THEME;
}

/** The company side seeds hyphenated template keys; normalise on read. */
export function normaliseTemplateKey(value: string | null | undefined): StorefrontTemplate {
  const key = (value ?? '').replace(/-/g, '_');
  return (STOREFRONT_TEMPLATES as readonly string[]).includes(key)
    ? (key as StorefrontTemplate)
    : DEFAULT_TEMPLATE;
}

/**
 * Closed vocabularies for the icons a store may pick.
 *
 * Each of these could have been a URL field, and each is a key instead for one
 * reason: an icon that renders in the header or footer of *every* page is the
 * best place on the shopfront to hang a remote image, and a store admin session
 * should not be a way to do that. The storefront owns the glyphs; this list is
 * only what the API will accept as a name for one.
 */
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'x',
  'youtube',
  'tiktok',
  'linkedin',
  'pinterest',
  'whatsapp',
] as const;

export const MOBILE_NAV_ICONS = [
  'home',
  'categories',
  'shop',
  'wishlist',
  'account',
  'cart',
  'search',
  'offers',
] as const;

export const CATEGORY_ICON_KEYS = [
  'electronics',
  'fashion',
  'home',
  'beauty',
  'sports',
  'toys',
  'tools',
  'automotive',
  'books',
  'health',
  'pets',
  'garden',
  'grocery',
  'music',
  'baby',
  'office',
] as const;

export const LOGIN_LOCK_THRESHOLD = 10;
export const LOGIN_LOCK_MINUTES = 15;
export const LOGIN_BACKOFF_MS = [0, 0, 250, 750, 1_500, 3_000, 5_000];

export const RECOVERY_CODE_COUNT = 10;

export const TOKEN_TTL = {
  passwordResetMinutes: 60,
} as const;

export const RATE_LIMITS = {
  login: { max: 10, windowSeconds: 900 },
  mfaVerify: { max: 8, windowSeconds: 900 },
  reauth: { max: 8, windowSeconds: 900 },
  forgotPassword: { max: 5, windowSeconds: 900 },
  recoveryCodes: { max: 3, windowSeconds: 3600 },
  upload: { max: 60, windowSeconds: 300 },
  bulkWrite: { max: 30, windowSeconds: 60 },
} as const;

/** Order lifecycle. Transitions are validated server-side — never free-form. */
export const ORDER_STATUSES = [
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
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The only moves the API will accept. Anything absent here is a 409. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['pending', 'confirmed', 'cancelled', 'failed'],
  pending: ['confirmed', 'cancelled', 'failed'],
  confirmed: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'returned'],
  out_for_delivery: ['delivered', 'returned'],
  delivered: ['returned'],
  returned: ['refunded'],
  refunded: [],
  cancelled: [],
  failed: [],
};

export const INVENTORY_BUCKETS = ['available', 'reserved', 'return_pending', 'damaged', 'incoming'] as const;
export type InventoryBucket = (typeof INVENTORY_BUCKETS)[number];

/** Default customer classification thresholds; overridable in store settings. */
export const CUSTOMER_THRESHOLDS = {
  repeatMinOrders: 2,
  vipMinOrders: 10,
  highValueMinSpend: 1000,
} as const;

export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'],
  videoTypes: ['video/mp4', 'video/webm'],
} as const;
