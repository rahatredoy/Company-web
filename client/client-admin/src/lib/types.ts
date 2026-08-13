/** Mirrors the commerce API's response shapes. Kept hand-written and small. */

export type StoreRole = 'STORE_SUPER_ADMIN' | 'STORE_ADMIN';

export type Permission =
  | 'dashboard.view'
  | 'products.view'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'categories.view'
  | 'categories.manage'
  | 'brands.view'
  | 'brands.manage'
  | 'attributes.view'
  | 'attributes.manage'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'orders.view'
  | 'orders.update'
  | 'orders.cancel'
  | 'customers.view'
  | 'customers.update'
  | 'returns.view'
  | 'returns.approve'
  | 'returns.reject'
  | 'refunds.view'
  | 'refunds.approve'
  | 'reviews.view'
  | 'reviews.manage'
  | 'marketing.view'
  | 'marketing.manage'
  | 'website.view'
  | 'website.manage'
  | 'reports.view'
  | 'staff.view'
  | 'staff.create'
  | 'staff.update'
  | 'staff.delete'
  | 'settings.view'
  | 'settings.update';

export interface Entitlements {
  planCode: string;
  planName: string;
  supportLevel: 'email' | 'priority' | 'dedicated';
  productLimit: number | null;
  adminLimit: number | null;
  storageLimitMb: number | null;
  customDomainEnabled: boolean;
  customAdminDomainEnabled: boolean;
  analyticsEnabled: boolean;
  reportsEnabled: boolean;
}

export interface SessionStore {
  slug: string;
  name: string;
  currency: string;
  language: string;
  timezone: string;
  status: string;
  planCode: string | null;
  planName: string | null;
  trial: { status: string; endsAt: string | null; daysRemaining: number } | null;
  entitlements: Entitlements | null;
}

export interface SessionAdmin {
  id: string;
  email: string;
  fullName: string;
  roleKey: StoreRole;
  mfaEnabled: boolean;
  permissions: Permission[];
}

export type SessionResponse =
  | { authenticated: true; admin: SessionAdmin; store: SessionStore }
  | {
      authenticated: false;
      mfaRequired?: boolean;
      mfaPending?: boolean;
      store?: { slug: string; name: string; status: string };
    };

export interface AdminSessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/**
 * Authorisation is enforced by the API on every route; this only decides what
 * the panel bothers to render. A super admin implicitly holds everything.
 */
export function can(
  admin: Pick<SessionAdmin, 'roleKey' | 'permissions'> | null | undefined,
  permission: Permission,
): boolean {
  if (!admin) return false;
  if (admin.roleKey === 'STORE_SUPER_ADMIN') return true;
  return admin.permissions.includes(permission);
}

/** A metric plus its movement against the previous period, for KPI cards. */
export interface MetricDelta {
  value: number;
  previous: number;
  /** Null when there is no previous period to compare against. */
  changePct: number | null;
  /** Optional trend series for the inline sparkline. */
  spark?: number[];
}

// --- Catalogue -----------------------------------------------------------------

export type ProductStatus = 'draft' | 'active' | 'inactive';

/** One row of `GET /categories`, which carries the product tally the list shows. */
export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  imageUrl: string | null;
  isActive: boolean;
  showInMenu: boolean;
  sortOrder: number;
  createdAt: string;
  productCount: number;
}

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  createdAt: string;
  productCount: number;
}

/**
 * One row of `GET /products`. `sku` and the two prices come from the product's
 * default variant — a product is browsed, a variant is what is actually bought.
 */
export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  type: 'simple' | 'variable';
  priceFrom: string | null;
  salePriceFrom: string | null;
  isFeatured: boolean;
  soldCount: number;
  createdAt: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  sku: string | null;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  price: string;
  salePrice: string | null;
  costPrice: string | null;
  weightGrams: number | null;
  imageUrl: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  type: 'simple' | 'variable';
  categoryId: string | null;
  brandId: string | null;
  shortDescription: string | null;
  description: string | null;
  priceFrom: string | null;
  salePriceFrom: string | null;
  isFeatured: boolean;
  isNewArrival: boolean;
  isReturnable: boolean;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  soldCount: number;
  publishedAt: string | null;
  createdAt: string;
  variants: ProductVariant[];
  defaultVariant: ProductVariant | null;
}

// --- Orders -----------------------------------------------------------------

export type OrderStatus =
  | 'new'
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'refunded'
  | 'failed';

export interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string;
  status: OrderStatus;
  paymentStatus: string;
  shippingStatus: string;
  grandTotal: string;
  currency: string;
  placedAt: string;
  itemCount: number;
}

export interface OrderLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  unitSalePrice: string | null;
  lineTotal: string;
  returnedQuantity: number;
}

export interface OrderAddressRow {
  type: 'shipping' | 'billing';
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
}

export interface OrderHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  adminLabel: string | null;
  createdAt: string;
}

export interface OrderShipment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  shippedAt: string | null;
}

export interface OrderDetailRow extends OrderRow {
  phone: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  refundedTotal: string;
  couponCode: string | null;
  paymentProvider: string | null;
  paymentMethodLabel: string | null;
  shippingMethodLabel: string | null;
  customerNote: string | null;
  adminNote: string | null;
  cancelReason: string | null;
  lines: OrderLine[];
  addresses: OrderAddressRow[];
  history: OrderHistoryEntry[];
  shipments: OrderShipment[];
  customer: { id: string; fullName: string; email: string } | null;
  /** What this order may become next. The panel offers only these. */
  allowedTransitions: OrderStatus[];
}

// --- Customers ---------------------------------------------------------------

export interface CustomerRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: 'active' | 'blocked';
  customerType: string;
  acceptsMarketing: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  totalSpent: string;
}

export interface CustomerDetail {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: 'active' | 'blocked';
  customerType: string;
  acceptsMarketing: boolean;
  emailVerified: boolean;
  adminNote: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  orders: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    grandTotal: string;
    currency: string;
    placedAt: string;
  }[];
  addresses: OrderAddressRow[];
}

// --- Reviews -----------------------------------------------------------------

export interface ReviewRow {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  customerName: string;
  rating: number;
  body: string | null;
  status: 'pending' | 'approved' | 'rejected';
  verifiedPurchase: boolean;
  adminReply: string | null;
  createdAt: string;
}

// --- Inventory ---------------------------------------------------------------

export type InventoryBucket = 'available' | 'reserved' | 'return_pending' | 'damaged' | 'incoming';

export interface InventoryRow {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantTitle: string | null;
  warehouseId: string;
  warehouseName: string;
  available: number;
  reserved: number;
  returnPending: number;
  damaged: number;
  incoming: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  city: string | null;
  country: string | null;
  isDefault: boolean;
  isActive: boolean;
}

// --- Shipping ----------------------------------------------------------------

export interface ShippingMethodRow {
  id: string;
  zoneId: string;
  name: string;
  description: string | null;
  price: string;
  freeAboveSubtotal: string | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ShippingZoneRow {
  id: string;
  name: string;
  countries: string[];
  cities: string[];
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  methods: ShippingMethodRow[];
}

// --- Returns and refunds -----------------------------------------------------

export type ReturnStatus =
  | 'requested'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'inspected'
  | 'completed';

export interface ReturnRow {
  id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: ReturnStatus;
  resolution: string;
  reason: string;
  refundableAmount: string;
  currency: string;
  createdAt: string;
}

export interface ReturnItemRow {
  id: string;
  orderItemId: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  inspectionResult: string | null;
  restockedQuantity: number;
  variantId: string | null;
}

export interface ReturnDetail extends ReturnRow {
  email: string;
  description: string | null;
  rejectionReason: string | null;
  adminNote: string | null;
  items: ReturnItemRow[];
  history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; adminLabel: string | null; createdAt: string }[];
  allowedTransitions: ReturnStatus[];
}

export type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';

export interface RefundRow {
  id: string;
  refundNumber: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: string;
  currency: string;
  status: RefundStatus;
  method: string | null;
  reason: string | null;
  createdAt: string;
  completedAt: string | null;
  allowedTransitions: RefundStatus[];
}

// --- Marketing ---------------------------------------------------------------

export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: string;
  maxDiscountAmount: string | null;
  minOrderAmount: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  status: 'active' | 'scheduled' | 'expired' | 'disabled';
}

export interface BannerRow {
  id: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  linkUrl: string | null;
  buttonLabel: string | null;
  position: 'home_hero' | 'home_promo' | 'category_top' | 'sidebar' | 'popup';
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface SubscriberRow {
  id: string;
  email: string;
  status: 'subscribed' | 'unsubscribed';
  source: string | null;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

// --- Website content ---------------------------------------------------------

export interface PageRow {
  id: string;
  title: string;
  slug: string;
  systemKey: string | null;
  status: 'draft' | 'published';
  showInFooter: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface PageDetail extends PageRow {
  excerpt: string | null;
  bodyHtml: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  isActive: boolean;
  sortOrder: number;
}

// --- Settings, attributes, reports --------------------------------------------

export interface StoreSettingsRow {
  storeName: string;
  slug: string;
  currency: string;
  language: string;
  timezone: string;
  businessName: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  businessAddress: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  whatsappNumber: string | null;
  whatsappEnabled: boolean;
  lowStockThreshold: number;
  orderCount: number;
}

export interface PaymentMethodRow {
  id: string;
  provider: 'cod' | 'mock' | 'stripe' | 'sslcommerz';
  label: string;
  description: string | null;
  instructions: string | null;
  isEnabled: boolean;
  sortOrder: number;
}

export interface AttributeValueRow {
  id: string;
  attributeId: string;
  value: string;
  slug: string;
  colorHex: string | null;
  sortOrder: number;
}

export interface AttributeRow {
  id: string;
  name: string;
  slug: string;
  inputType: 'select' | 'color' | 'text' | 'number';
  isVariantAttribute: boolean;
  isFilterable: boolean;
  unit: string | null;
  sortOrder: number;
  values: AttributeValueRow[];
}

export interface ReportsPayload {
  days: number;
  currency: string;
  totals: {
    orders: number;
    revenue: string;
    discounts: string;
    refunded: string;
    averageOrderValue: string;
    newCustomers: number;
    activeProducts: number;
  };
  daily: { day: string; orders: number; revenue: string }[];
  topProducts: { productId: string | null; name: string; units: number; revenue: string }[];
}
