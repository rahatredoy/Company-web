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

// --- Dashboard -----------------------------------------------------------------

export type DashboardGranularity = 'day' | 'week' | 'month';

/**
 * One panel's worth of the home screen, and whether it can be drawn.
 *
 * The dashboard is a screen made of eight independent readings, and the three
 * ways one of them can be missing are three different screens: `forbidden` means
 * the admin may not see it, `failed` means the query broke, `unavailable` means
 * the whole call did — and an `ok` section holding an empty list means the shop
 * genuinely has nothing there yet. Collapsing any of those into "empty" tells
 * an owner their orders vanished when the truth was a dropped connection.
 */
export type DashboardSection<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'forbidden' | 'failed' | 'unavailable'; message: string };

export interface DashboardMetrics {
  revenue: MetricDelta;
  orders: MetricDelta;
  pendingOrders: MetricDelta;
  newCustomers: MetricDelta;
  totals: {
    revenue: string;
    discounts: string;
    refunded: string;
    averageOrderValue: string;
    activeProducts: number;
    totalProducts: number;
  };
}

export interface DashboardSeries {
  granularity: DashboardGranularity;
  points: { bucket: string; orders: number; revenue: string }[];
}

export interface DashboardOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  paymentStatus: string;
  currency: string;
  grandTotal: string;
  itemCount: number;
  placedAt: string;
}

export interface DashboardTopProducts {
  /**
   * `period` is what sold inside the chosen window. `all_time` is the fallback
   * the API reaches for when the window sold nothing but the catalogue has a
   * lifetime `sold_count` behind it — real sales, just not this week's, which is
   * why the panel has to say which of the two it is showing. An `all_time` row
   * carries no revenue: `sold_count` counts units, and what they were charged at
   * is long gone.
   */
  scope: 'period' | 'all_time';
  products: {
    productId: string | null;
    name: string;
    imageUrl: string | null;
    units: number;
    revenue: string | null;
  }[];
}

export interface DashboardLowStock {
  /** Point-in-time, not a window — stock keeps no history to compare against. */
  low: number;
  out: number;
  tracked: number;
  items: {
    variantId: string;
    productId: string;
    productName: string;
    variantTitle: string | null;
    sku: string;
    imageUrl: string | null;
    available: number;
    reserved: number;
    incoming: number;
    threshold: number;
  }[];
}

/** `GET /admin/dashboard` — one call, one section per panel. */
export interface DashboardPayload {
  range: {
    days: number;
    granularity: DashboardGranularity;
    timezone: string;
    from: string;
    /** Exclusive: the instant the window ends, not its last second. */
    to: string;
    previousFrom: string;
    previousTo: string;
  };
  currency: string;
  sections: {
    metrics: DashboardSection<DashboardMetrics>;
    series: DashboardSection<DashboardSeries>;
    recentOrders: DashboardSection<DashboardOrder[]>;
    topProducts: DashboardSection<DashboardTopProducts>;
    lowStock: DashboardSection<DashboardLowStock>;
    reviews: DashboardSection<{ pending: number }>;
  };
}

// --- Catalogue -----------------------------------------------------------------

export type ProductStatus = 'draft' | 'active' | 'inactive';

/** One row of `GET /categories`, which carries the product tally the list shows. */
export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  /** The small mark shown beside the name in the storefront menu. */
  iconUrl: string | null;
  bannerUrl: string | null;
  isActive: boolean;
  showInMenu: boolean;
  isFeatured: boolean;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
  productCount: number;
}

/**
 * One row of `GET /brands`, which carries every column the editor writes back —
 * the panel opens from a row already on screen, so a second fetch per click
 * would only make opening it wait on the network.
 */
export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
  productCount: number;
}

/**
 * One row of `GET /products`. `sku`, `imageUrl` and the two prices come from the
 * product's default variant — a product is browsed, a variant is what is
 * actually bought.
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
  isNewArrival: boolean;
  soldCount: number;
  ratingAverage: string;
  ratingCount: number;
  /** Off means stock is still counted but never refuses a sale. */
  trackInventory: boolean;
  createdAt: string;
  updatedAt: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  sku: string | null;
  barcode: string | null;
  /** The default variant's. Never shown to a shopper; it is what margin is from. */
  costPrice: string | null;
  /**
   * The default variant's sale window, so the quick-edit panel can offer it
   * without a second read. Both enforced — see `ProductVariant`.
   */
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  imageUrl: string | null;
  /** Sellable units across every warehouse. */
  stock: number;
  /** Committed to orders that have not shipped, and already out of `stock`. */
  reserved: number;
  /** On a purchase order, not yet received. */
  incoming: number;
  lowStockThreshold: number;
  /**
   * How many `inventory_levels` rows are behind `stock`. Zero means nothing was
   * ever recorded — a different thing from having sold the last one, and the only
   * way to tell those apart, since both count zero available.
   */
  stockRecords: number;
  variantCount: number;
}

/** `GET /products/stats` — counted across the catalogue, not over one page. */
export interface ProductStats {
  total: number;
  active: number;
  draft: number;
  inactive: number;
  featured: number;
  addedThisMonth: number;
  outOfStock: number;
  lowStock: number;
  untracked: number;
  unitsInStock: number;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  title: string | null;
  barcode: string | null;
  price: string;
  salePrice: string | null;
  /**
   * When the sale price applies. Both nullable, and both **enforced** —
   * `client-api/src/modules/storefront/service.ts#effectiveSale` ignores a sale
   * price outside its window at checkout as well as on the product page, so a
   * sale that has not started is not a sale and an expired one charges full
   * price. A null bound means "no bound".
   */
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  costPrice: string | null;
  weightGrams: number | null;
  imageUrl: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /**
   * What is on the shelf, summed across warehouses — and `null` when the variant
   * has no `inventory_levels` row at all.
   *
   * The two are not the same and must not be shown as the same: a variant
   * counted down to zero is sold out, one that was never counted is sellable
   * without limit. Both read as zero if the distinction is thrown away, and only
   * one of them is a mistake worth chasing.
   */
  stock: number | null;
  reserved: number;
  /** Which attribute values this variant *is* — `Size: M`, `Colour: Black`. */
  attributeValueIds: string[];
}

/** A gallery image. The product form's single picture is not one of these. */
export interface ProductMediaRow {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface ProductSpecificationRow {
  id: string;
  groupName: string | null;
  label: string;
  value: string;
  isKeySpec: boolean;
  sortOrder: number;
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
  /** One optional clip, kept beside the gallery rather than inside it. */
  videoUrl: string | null;
  /**
   * Whether stock is allowed to refuse a sale. Off is not the same as having no
   * stock records: an untracked product can still hold a count worth reading.
   */
  trackInventory: boolean;
  /**
   * Sold one at a time, or weighed out.
   *
   * `measure` is what puts the 1kg / 500gm / 250gm picker on the storefront
   * card. The four fields under it are only meaningful in that mode and are
   * cleared by the API when it is switched off, so a stale "Per 1kg" cannot
   * survive on a product now sold singly.
   */
  sellBy: 'unit' | 'measure';
  /** The base unit stock is counted in: `g`, `ml` or `pc`. */
  measureUnit: string | null;
  /** How many base units the price covers. 1000 = the price is per kilo. */
  pricingMeasure: number | null;
  pricingLabel: string | null;
  minMeasure: number | null;
  /** Null defers to the shop's default list in Settings. */
  measureOptions: { label: string; measure: number }[] | null;
  publishedAt: string | null;
  createdAt: string;
  variants: ProductVariant[];
  defaultVariant: ProductVariant | null;
  /*
   * Each of these is written back as a whole list, so the editor has to be able
   * to read the current one — a form that opened empty would save that emptiness
   * over what is stored the first time anything else on the page was touched.
   */
  media: ProductMediaRow[];
  specifications: ProductSpecificationRow[];
  attributeValueIds: string[];
  bundleProductIds: string[];
}

/**
 * `GET /products/:id/insights` — the whole product screen, in one call.
 *
 * A screen shape rather than a resource: it answers what the page asks and may
 * change with it. `/products/:id` stays the contract the editor writes against.
 */
export interface ProductInsights {
  currency: string;
  range: { days: number; timezone: string };

  product: {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
    type: 'simple' | 'variable';
    imageUrl: string | null;
    videoUrl: string | null;
    sku: string | null;
    barcode: string | null;
    /** The parent when the product is filed under a child category. */
    category: { id: string; name: string | null } | null;
    /** Null when the product sits at the top level rather than under a child. */
    subcategory: { id: string | null; name: string | null } | null;
    brand: { id: string; name: string | null } | null;
    price: string | null;
    salePrice: string | null;
    costPrice: string | null;
    trackInventory: boolean;
    isFeatured: boolean;
    isNewArrival: boolean;
    isReturnable: boolean;
    variantCount: number;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };

  stock: {
    /** Units the shop put on the shelf itself — not returns coming back. */
    received: number;
    available: number;
    reserved: number;
    returnPending: number;
    damaged: number;
    incoming: number;
    restocked: number;
    writtenOff: number;
    returned: number;
    /** Dispatched. Moves on dispatch and nowhere else. */
    sold: number;
    lowStockThreshold: number;
    /** Zero means never recorded — a different thing from having sold the last one. */
    stockRecords: number;
    tracked: boolean;
    isUntracked: boolean;
    isLow: boolean;
    isOut: boolean;
  };

  money: {
    revenue: string;
    discount: string;
    refunded: string;
    /** Today's cost price applied to past sales — an estimate, not a ledger. */
    cost: string;
    estimatedProfit: string;
    averageSellingPrice: string | null;
    /** Ordered, not dispatched — the basis the revenue beside it divides by. */
    units: number;
    orders: number;
    unitCost: string | null;
  };

  variants: {
    id: string;
    sku: string;
    title: string | null;
    price: string;
    salePrice: string | null;
    costPrice: string | null;
    imageUrl: string | null;
    isDefault: boolean;
    isActive: boolean;
    available: number;
    reserved: number;
    returnPending: number;
    damaged: number;
    incoming: number;
    stockRecords: number;
    lowStockThreshold: number;
    sold: number;
    returned: number;
  }[];

  movements: {
    id: string;
    type: string;
    quantity: number;
    fromBucket: string | null;
    toBucket: string | null;
    availableAfter: number;
    reservedAfter: number;
    referenceType: string | null;
    referenceId: string | null;
    /** Resolved when the reference is an order, so the row can link to it. */
    orderNumber: string | null;
    damageReason: string | null;
    note: string | null;
    adminLabel: string | null;
    sku: string;
    variantTitle: string | null;
    createdAt: string;
  }[];

  sales: {
    /** Gap-free and in the store's own timezone: a quiet day is a zero, not a gap. */
    series: { bucket: string; units: number; revenue: string }[];
    bestVariant: { id: string; sku: string; title: string | null; sold: number } | null;
  };

  returns: {
    requests: number;
    units: number;
    open: number;
    restocked: number;
    damaged: number;
    /** What the returned units were worth, on returns that completed. */
    value: string;
    /** Against units ordered. Null when nothing has been ordered to divide by. */
    rate: number | null;
  };

  activity: {
    wishlistCount: number;
    reviewCount: number;
    pendingReviews: number;
    ratingAverage: number;
    ratingCount: number;
    viewCount: number;
  };
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
  customerId: string | null;
  customerName: string;
  email: string;
  phone: string | null;
  status: OrderStatus;
  paymentStatus: string;
  shippingStatus: string;
  paymentProvider: string | null;
  grandTotal: string;
  currency: string;
  placedAt: string;
  itemCount: number;
  /**
   * What this order may become next. Comes from the API's own transition map, so
   * the list can advance an order without the panel deciding what is legal.
   */
  allowedTransitions: OrderStatus[];
}

/** `GET /orders/stats` — counted across the whole book of orders. */
export interface OrderStats {
  total: number;
  todayOrders: number;
  todayRevenue: string;
  /** Still the shop's problem: new, pending, confirmed, processing or packed. */
  openOrders: number;
  unpaid: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  revenue30d: string;
  averageOrderValue: string;
  byStatus: Record<string, number>;
  byPaymentStatus: Record<string, number>;
  /** The store's own timezone, which is what "today" was counted in. */
  timezone: string;
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
  /**
   * The size sold, for a product sold by weight or volume — "500gm".
   *
   * Null on an ordinary line. What the shop has to weigh out is the quantity
   * *times* this, which is what `stockUnitsOf` works out and what the packing
   * screens print, because "2" on its own is the one thing that would get a
   * parcel packed wrong.
   */
  measureLabel: string | null;
  measure: number | null;
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
  productSlug: string;
  sku: string;
  variantTitle: string | null;
  imageUrl: string | null;
  /** Null when never recorded — it contributes nothing to the stock value. */
  costPrice: string | null;
  price: string;
  warehouseId: string;
  warehouseName: string;
  available: number;
  reserved: number;
  returnPending: number;
  damaged: number;
  incoming: number;
  lowStockThreshold: number;
  /**
   * The unit every count on this row is in.
   *
   * Null for an ordinary product, where they are whole items. For one sold by
   * weight or volume they are **base units** — 40000 means 40kg, and printing
   * the bare number would tell the owner they have forty thousand pumpkins.
   * `formatStock` in `lib/measure.ts` is what turns it back into words.
   */
  measureUnit: string | null;
  updatedAt: string;
}

/** `GET /inventory/stats` — counted over every tracked level. */
export interface InventoryStats {
  tracked: number;
  inStock: number;
  low: number;
  out: number;
  unitsAvailable: number;
  unitsReserved: number;
  unitsIncoming: number;
  unitsDamaged: number;
  /** Available units × cost price, as a decimal string. */
  valueAtCost: string;
  warehouses: number;
  /** Variants with no stock record at all — unsellable, and easy to miss. */
  untrackedVariants: number;
}

export interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
}

/**
 * One movement from the ledger. `availableAfter` is a snapshot taken inside the
 * same transaction as the move, so the history reads as a running balance
 * without anything having to re-derive it.
 */
/**
 * One row of the append-only ledger. Every change to a level writes one in the
 * same transaction, which is what makes a level explainable rather than merely
 * current — `availableAfter` is the snapshot taken as the move landed.
 */
export interface InventoryTransactionRow {
  id: string;
  variantId: string;
  warehouseId: string;
  type: string;
  /** Signed. Negative takes units out of the bucket. */
  quantity: number;
  fromBucket: string | null;
  toBucket: string | null;
  availableAfter: number;
  reservedAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  damageReason: string | null;
  note: string | null;
  /** Null for a system move, such as an order reserving stock. */
  adminId: string | null;
  adminLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
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
  /** Where it goes when the destination is a path rather than a category. */
  linkUrl: string | null;
  /** The category or subcategory it opens. Outranks `linkUrl` when both are set. */
  categoryId: string | null;
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

/**
 * The section vocabulary the storefront can render. Kept in step with
 * `client-api/src/lib/constants.ts#HOMEPAGE_SECTION_TYPES` — a key this list
 * knows and the API does not is refused on save.
 */
export const HOMEPAGE_SECTION_TYPES = [
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
  'newsletter',
  'text',
  'collection',
  'social_gallery',
  'recently_viewed',
] as const;

export type HomepageSectionType = (typeof HOMEPAGE_SECTION_TYPES)[number];

export interface HomepageSectionRow {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown>;
  isEnabled: boolean;
  sortOrder: number;
}

export interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: 'new' | 'read' | 'replied' | 'archived';
  createdAt: string;
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
  /**
   * The shop's default size picker for products sold by weight or volume.
   *
   * Set once here because a greengrocer sells most of its catalogue the same
   * four ways; a product may still name its own list. Empty means every measure
   * product falls back to `defaultMeasureOptions`.
   */
  measureOptions: { label: string; measure: number }[];
  /** What the platform offers when neither the product nor the shop names a list. */
  defaultMeasureOptions: { label: string; measure: number }[];
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
  /** Variants built on this value — deleting it would unmake their options. */
  variantCount: number;
  productCount: number;
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
  /** Products reached through any of this attribute's values. */
  productCount: number;
  variantCount: number;
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

// --- View panels --------------------------------------------------------------

/**
 * What the **View** panels read.
 *
 * Every list in the panel opens the row itself beside the list rather than
 * sending the reader to the storefront, and each of these is the whole database
 * row plus the rows that point at it — which is why they are separate from the
 * `*Row` types above. A list row is what a table column needs; these are what
 * the record actually is.
 *
 * A field here is only optional when the API genuinely may not send it. Anything
 * the column is nullable for is `| null`, so a panel renders an em dash rather
 * than a blank where a value was promised.
 */

/** One `customer_addresses` row, whole — the customer panel shows all of them. */
export interface CustomerAddressRow {
  id: string;
  customerId: string;
  label: string | null;
  type: 'shipping' | 'billing';
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A browser the shopper is signed in on. The session token is stored only as a
 * SHA-256 and is never sent here — what is shown is the device, not the key.
 */
export interface CustomerSessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  remember: boolean;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

/** `GET /customers/:id` — every column but `password_hash`, plus the account. */
export interface CustomerView {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: 'active' | 'blocked';
  customerType: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  acceptsMarketing: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  /** Locked right now, rather than a timestamp the reader has to compare. */
  isLocked: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  passwordChangedAt: string | null;
  /** Whether a password exists at all. The hash itself never leaves the API. */
  hasPassword: boolean;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  stats: {
    orderCount: number;
    totalSpent: string;
    refundedTotal: string;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    reviewCount: number;
    wishlistCount: number;
  };
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: string;
    shippingStatus: string;
    itemCount: number;
    grandTotal: string;
    refundedTotal: string;
    currency: string;
    placedAt: string;
  }[];
  addresses: CustomerAddressRow[];
  sessions: CustomerSessionRow[];
}

export interface OrderPaymentRow {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  refundedAmount: string;
  providerReference: string | null;
  clientReference?: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * `GET /orders/:id`, which already answered with the whole `orders` row — this
 * is that row typed out, plus the refunds and returns raised against it.
 */
export interface OrderView extends OrderDetailRow {
  shippingMethodId: string | null;
  estimatedDeliveryAt: string | null;
  cancelledAt: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** Whether the reservation has been given back. Cancelling is what sets it. */
  inventoryReleased: boolean;
  couponId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  payments: OrderPaymentRow[];
  refunds: {
    id: string;
    refundNumber: string;
    status: RefundStatus;
    amount: string;
    currency: string;
    method: string | null;
    reason: string | null;
    returnId: string | null;
    completedAt: string | null;
    createdAt: string;
  }[];
  returns: {
    id: string;
    returnNumber: string;
    status: ReturnStatus;
    resolution: string;
    reason: string;
    refundableAmount: string;
    createdAt: string;
  }[];
}

/** `GET /reviews/:id` — the whole row, its images and what it is attached to. */
export interface ReviewView {
  id: string;
  productId: string;
  customerId: string | null;
  orderId: string | null;
  /** Snapshot taken when it was written; the account may since have been renamed. */
  customerName: string;
  rating: number;
  body: string | null;
  status: 'pending' | 'approved' | 'rejected';
  verifiedPurchase: boolean;
  helpfulCount: number;
  adminReply: string | null;
  adminRepliedAt: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  productName: string;
  productSlug: string;
  productStatus: ProductStatus;
  orderNumber: string | null;
  customerEmail: string | null;
  customerStatus: string | null;
  images: { id: string; url: string; objectKey: string; createdAt: string }[];
}

/** `GET /refunds/:id` — the row, the order it draws on and how it was paid. */
export interface RefundView {
  id: string;
  refundNumber: string;
  orderId: string;
  returnId: string | null;
  customerId: string | null;
  paymentId: string | null;
  status: RefundStatus;
  amount: string;
  currency: string;
  reason: string | null;
  method: string | null;
  providerReference: string | null;
  failureReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  allowedTransitions: RefundStatus[];
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: string;
    paymentProvider: string | null;
    paymentMethodLabel: string | null;
    grandTotal: string;
    refundedTotal: string;
    currency: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    placedAt: string;
  };
  returnNumber: string | null;
  returnStatus: ReturnStatus | null;
  customerEmail: string | null;
  /** What could still be refunded on the order, this refund included. */
  remainingOnOrder: string;
  payments: OrderPaymentRow[];
}

/** `GET /returns/:id` — the whole row, its lines, evidence and paper trail. */
export interface ReturnView {
  id: string;
  returnNumber: string;
  orderId: string;
  customerId: string | null;
  status: ReturnStatus;
  resolution: string;
  reason: string;
  description: string | null;
  refundableAmount: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  customerName: string;
  email: string;
  phone: string | null;
  currency: string;
  orderTotal: string;
  orderRefundedTotal: string;
  orderPlacedAt: string;
  items: {
    id: string;
    orderItemId: string;
    productId: string | null;
    productName: string;
    variantTitle: string | null;
    imageUrl: string | null;
    sku: string | null;
    quantity: number;
    orderedQuantity: number;
    unitPrice: string;
    lineTotal: string;
    inspectionResult: string | null;
    inspectionNote: string | null;
    restockedQuantity: number;
    variantId: string | null;
  }[];
  history: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    adminId: string | null;
    adminLabel: string | null;
    createdAt: string;
  }[];
  attachments: {
    id: string;
    url: string;
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  refunds: {
    id: string;
    refundNumber: string;
    status: RefundStatus;
    amount: string;
    currency: string;
    method: string | null;
    completedAt: string | null;
    createdAt: string;
  }[];
  allowedTransitions: ReturnStatus[];
}

/** `GET /inventory/:id`, keyed by the **level** id the list row carries. */
export interface InventoryView {
  id: string;
  variantId: string;
  warehouseId: string;
  available: number;
  reserved: number;
  returnPending: number;
  damaged: number;
  incoming: number;
  lowStockThreshold: number;
  updatedAt: string;
  /** Everything physically in the building, sellable or not. */
  onHand: number;
  variant: {
    id: string;
    productId: string;
    sku: string;
    title: string | null;
    barcode: string | null;
    price: string;
    salePrice: string | null;
    costPrice: string | null;
    weightGrams: number | null;
    imageUrl: string | null;
    isDefault: boolean;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
  };
  product: {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
    productType: 'simple' | 'variable';
    /** Off means stock is still counted but never refuses a sale. */
    trackInventory: boolean;
    isReturnable: boolean;
    minOrderQuantity: number;
    maxOrderQuantity: number | null;
    soldCount: number;
    /** `measure` means every count on this record is in base units. */
    sellBy: 'unit' | 'measure';
    measureUnit: string | null;
    pricingLabel: string | null;
  };
  warehouse: {
    id: string;
    name: string;
    code: string;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    isDefault: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  otherWarehouses: {
    id: string;
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    available: number;
    reserved: number;
    damaged: number;
    incoming: number;
    returnPending: number;
  }[];
  transactions: InventoryTransactionRow[];
}

/** `GET /coupons/:id` — the rules, and the ledger `used_count` is made of. */
export interface CouponView extends CouponRow {
  scope: string;
  targetIds: string[] | null;
  isStackable: boolean;
  createdAt: string;
  updatedAt: string;
  redemptionCount: number;
  totalDiscounted: string;
  redemptions: {
    id: string;
    orderId: string;
    orderNumber: string | null;
    orderStatus: string | null;
    customerId: string | null;
    customerName: string | null;
    email: string | null;
    discountAmount: string;
    createdAt: string;
  }[];
}

/** `GET /banners/:id`, with the category a `category_top` banner is pinned to. */
export interface BannerView extends BannerRow {
  categoryName: string | null;
  categorySlug: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /newsletter/:id`. The unsubscribe token is reported as a flag, not a value. */
export interface SubscriberView extends SubscriberRow {
  customerId: string | null;
  hasUnsubscribeToken: boolean;
  customerName: string | null;
  customerEmail: string | null;
  customerStatus: string | null;
  acceptsMarketing: boolean | null;
}

/** `GET /contact-messages/:id`, with any account matching the sender's address. */
export interface ContactMessageView extends ContactMessageRow {
  ipAddress: string | null;
  repliedAt: string | null;
  account: {
    id: string;
    fullName: string;
    email: string;
    status: string;
    createdAt: string;
    orderCount: number;
  } | null;
}

/**
 * `GET /products/:id` — the whole `products` row, which the endpoint has always
 * spread but `ProductDetail` never named.
 *
 * `ProductDetail` is the *editor's* view: it lists the fields the five tabs
 * write back, so anything the form does not own was left out of the type even
 * though the API sends it. The view panel is the opposite — it shows what the
 * row holds, including the four figures the shop never sets by hand.
 */
export interface ProductView extends ProductDetail {
  updatedAt: string;
  /** Maintained by the order pipeline and by reads; never accepted from a body. */
  viewCount: number;
  ratingAverage: string;
  ratingCount: number;
  /** Null falls back to the store-wide window in settings. */
  returnWindowDays: number | null;
}
