import type { ColorThemeKey } from '@/themes';
import type { TemplateKey } from '@/templates/meta';

/**
 * The contract between this storefront and the Commerce API.
 *
 * Written by hand rather than generated, because it is the place where the
 * frontend states what it needs — and because a field the API does not send yet
 * should show up as a compile error here, not as `undefined` at runtime.
 */

// ---------------------------------------------------------------- store ----

export interface NavigationNode {
  id: string;
  label: string;
  href: string;
  opensInNewTab: boolean;
  children: NavigationNode[];
}

export interface CategoryMenuEntry {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  /**
   * Glyph key from a closed set the storefront owns, chosen by the store.
   *
   * A key rather than a URL: this icon renders in the header of every page,
   * which makes it the best place on the shopfront to hang a remote image.
   */
  iconKey: string | null;
  children: { id: string; name: string; slug: string }[];
}

/** One social profile in the footer. `platform` picks the glyph. */
export interface SocialLink {
  platform: string;
  url: string;
}

export interface FooterColumn {
  id: string;
  title: string;
  links: { label: string; href: string }[];
}

export interface UtilityLink {
  label: string;
  href: string;
}

export interface MobileNavItem {
  label: string;
  href: string;
  /** Closed-set icon key, resolved by `MobileBottomNav`. */
  icon: string;
}

/**
 * One line in the announcement strip.
 *
 * A list rather than a single string because every store runs more than one
 * notice at a time — a shipping threshold, a live campaign, a holiday cutoff —
 * and rotating them is the only way to say all three in 32 pixels of height.
 */
export interface AnnouncementMessage {
  id: string;
  text: string;
  linkUrl: string | null;
  linkLabel: string | null;
}

/**
 * The visitor's resolved language and display currency.
 *
 * Threaded through chrome and page components rather than read from cookies
 * wherever it is needed: cookie access forces a component to be server-only,
 * and every price on the page would otherwise have to become one.
 */
export interface StorefrontLocale {
  language: string;
  currency: string;
}

export interface StoreConfig {
  store: {
    slug: string;
    name: string;
    tagline: string | null;
    currency: string;
    language: string;
    timezone: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    /** Absolute origin for canonical URLs, OpenGraph and the sitemap. */
    canonicalOrigin: string;
    /**
     * Every language and currency this store has switched on. A selector is
     * shown only when there is genuinely a choice — offering one option is a
     * control that cannot do anything.
     */
    languages: string[];
    currencies: string[];
  };
  design: {
    templateKey: TemplateKey;
    colorThemeKey: ColorThemeKey;
  };
  announcement: {
    enabled: boolean;
    messages: AnnouncementMessage[];
  };
  contact: {
    businessName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    whatsappNumber: string | null;
    whatsappEnabled: boolean;
  };
  /** Desktop strip above the header. Empty means the store configured none. */
  utility: UtilityLink[];
  navigation: { header: NavigationNode[]; footer: NavigationNode[] };
  /**
   * Footer link columns as the store arranged them. Empty draws the brand block
   * alone — an invented column is worse than none, because half of it would 404.
   */
  footerColumns: FooterColumn[];
  social: SocialLink[];
  /** Mobile bottom bar. Empty hides the bar rather than guessing destinations. */
  mobileNav: MobileNavItem[];
  categoryMenu: CategoryMenuEntry[];
  policyPages: { slug: string; title: string; systemKey: string | null }[];
  payment: { providers: { provider: string; label: string; description: string | null }[] };
  seo: { title: string | null; description: string | null; socialImageUrl: string | null };
  /** Anything other than a trading status renders the unavailable page. */
  status: 'pending' | 'provisioning' | 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';
}

// -------------------------------------------------------------- catalog ----

export interface Money {
  /** Decimal string, never a float — money is formatted, not arithmetic'd, here. */
  amount: string;
  currency: string;
}

export interface ProductImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

/** What a listing needs. Deliberately smaller than `Product`. */
export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  brand: { id: string; name: string; slug: string } | null;
  primaryImage: ProductImage | null;
  /** Shown on hover where the template supports it. */
  secondaryImage: ProductImage | null;
  price: string;
  salePrice: string | null;
  /** Server-computed, so the badge cannot disagree with the price. */
  discountPercent: number | null;
  currency: string;
  ratingAverage: number;
  ratingCount: number;
  inStock: boolean;
  lowStock: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  /** One-line spec for the electronics card. */
  keySpec: string | null;
  hasVariants: boolean;
}

export interface VariantOption {
  attributeId: string;
  attributeName: string;
  slug: string;
  inputType: 'select' | 'color' | 'text' | 'number';
  values: { id: string; value: string; slug: string; colorHex: string | null }[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  title: string | null;
  price: string;
  salePrice: string | null;
  discountPercent: number | null;
  inStock: boolean;
  lowStock: boolean;
  /** Only ever a coarse band — exact warehouse counts stay internal. */
  stockLabel: 'in_stock' | 'low_stock' | 'out_of_stock';
  remainingHint: number | null;
  imageUrl: string | null;
  /** attributeId → attributeValueId, so the selector can match a combination. */
  selection: Record<string, string>;
}

export interface ProductDetail extends Omit<ProductSummary, 'primaryImage' | 'secondaryImage'> {
  shortDescription: string | null;
  description: string | null;
  images: ProductImage[];
  videoUrl: string | null;
  category: { id: string; name: string; slug: string } | null;
  breadcrumb: { name: string; slug: string }[];
  options: VariantOption[];
  variants: ProductVariant[];
  defaultVariantId: string | null;
  specifications: { groupName: string | null; label: string; value: string; isKeySpec: boolean }[];
  shippingInfo: string | null;
  returnInfo: string | null;
  isReturnable: boolean;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  seo: { title: string | null; description: string | null };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  productCount: number;
  children: Category[];
  breadcrumb: { name: string; slug: string }[];
  seo: { title: string | null; description: string | null };
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  productCount: number;
  seo: { title: string | null; description: string | null };
}

// -------------------------------------------------- listing, filters, sort --

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'best_selling', label: 'Best Selling' },
  { value: 'rating', label: 'Highest Rated' },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]['value'];

export interface FilterGroup {
  key: string;
  label: string;
  type: 'checkbox' | 'color' | 'range' | 'rating';
  options: { value: string; label: string; count: number; colorHex?: string | null }[];
  /** Present for `range` groups. */
  min?: number;
  max?: number;
}

export interface ProductListResult {
  items: ProductSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  /** Only the facets that actually narrow this result set. */
  filters: FilterGroup[];
  appliedFilters: Record<string, string[]>;
}

export interface SearchSuggestion {
  type: 'product' | 'category' | 'brand';
  id: string;
  label: string;
  href: string;
  imageUrl: string | null;
  price: string | null;
  meta: string | null;
}

// --------------------------------------------------------------- content ----

export type HomepageSectionType =
  | 'hero'
  | 'category_grid'
  /** Circular icon rail, as opposed to `category_grid`'s picture cards. */
  | 'category_circle'
  | 'product_grid'
  | 'product_carousel'
  | 'banner'
  | 'deal'
  | 'promo_trio'
  | 'flash_sale'
  | 'benefits'
  | 'lookbook'
  | 'testimonial'
  | 'brands'
  | 'newsletter'
  | 'text'
  /** A curated `collections` row: its own name, blurb, cover and products. */
  | 'collection'
  /** The shop's social photography — a square feed that links out. */
  | 'social_gallery'
  /**
   * A per-visitor rail. The only section whose contents the server never sees:
   * the browser holds the list, so the payload carries no ids at all.
   */
  | 'recently_viewed';

export interface HomepageSection {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  /** Type-specific and validated per type before render; never executed. */
  config: Record<string, unknown>;
}

export interface HeroSlide {
  id: string;
  eyebrow: string | null;
  heading: string;
  /**
   * A word inside `heading` that is set in the display face — the "Style" in
   * "Find Your *Style*". Kept as data rather than markup so the store owner
   * controls the emphasis without being handed an HTML field.
   */
  accentWord: string | null;
  subheading: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  primaryCta: { label: string; href: string } | null;
  secondaryCta: { label: string; href: string } | null;
  /** The circular "Up to 50% Off" medallion. */
  badge: { text: string; tone: 'primary' | 'sale' | 'accent' } | null;
  /** Avatar cluster plus a line such as "Trusted by 50,000+ happy customers". */
  socialProof: { avatarUrls: string[]; text: string } | null;
  align: 'left' | 'center';
  /** How hard the image is dimmed behind the copy. */
  overlay: 'none' | 'scrim' | 'soft';
}

export interface PromoBanner {
  id: string;
  title: string | null;
  subtitle: string | null;
  /** Small kicker above the title, e.g. "Special Offer". */
  eyebrow: string | null;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  linkUrl: string | null;
  buttonLabel: string | null;
  /** A coupon chip rendered inside the card, e.g. "Use Code: URBAN20". */
  couponCode: string | null;
  /** Tinted card backgrounds, for the trio layout that has no photography. */
  tone: 'none' | 'primary' | 'peach' | 'mint' | 'sky' | 'sand' | 'dark';
}

export interface LookbookTile {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
  caption: string | null;
}

export interface Testimonial {
  id: string;
  quote: string;
  /** Null when the store gave no attribution; never a stand-in name. */
  authorName: string | null;
  authorTitle: string | null;
  avatarUrl: string | null;
  rating: number | null;
}

/**
 * A curated collection, resolved server-side from the `collections` table.
 *
 * Carries its own name and cover, which is what separates it from a product
 * grid pointed at the same ids: a collection is a thing the store named, not
 * just a selection from the catalogue.
 */
export interface CollectionBlock {
  name: string;
  description: string | null;
  imageUrl: string | null;
  productIds: string[];
}

/** One square in the social gallery. */
export interface GalleryTile {
  id: string;
  imageUrl: string;
  /** Outbound post permalink — the one place a section may link off-site. */
  linkUrl: string | null;
  caption: string | null;
}

export interface CmsPage {
  slug: string;
  title: string;
  excerpt: string | null;
  /** Sanitised server-side before it is ever sent here. */
  bodyHtml: string | null;
  updatedAt: string;
  seo: { title: string | null; description: string | null };
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  category: string | null;
}

// ------------------------------------------------------------------ cart ----

export interface CartLine {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPrice: string;
  unitSalePrice: string | null;
  quantity: number;
  lineTotal: string;
  inStock: boolean;
  /** Set when stock fell below the requested quantity since it was added. */
  availableQuantity: number | null;
}

export interface CartTotals {
  subtotal: string;
  discount: string;
  shipping: string | null;
  tax: string;
  total: string;
  currency: string;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  totals: CartTotals;
  coupon: { code: string; label: string | null; discount: string } | null;
  itemCount: number;
}

// -------------------------------------------------------------- customer ----

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  acceptsMarketing: boolean;
}

export interface Address {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

export interface OrderSummary {
  orderNumber: string;
  placedAt: string;
  status: string;
  paymentStatus: string;
  itemCount: number;
  total: string;
  currency: string;
}

export interface OrderTimelineEntry {
  status: string;
  label: string;
  at: string | null;
  reached: boolean;
}

export interface OrderDetail extends OrderSummary {
  email: string;
  customerName: string;
  lines: {
    name: string;
    variantTitle: string | null;
    sku: string | null;
    imageUrl: string | null;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    productSlug: string | null;
  }[];
  totals: CartTotals;
  shippingAddress: Omit<Address, 'id' | 'isDefault' | 'label'> | null;
  billingAddress: Omit<Address, 'id' | 'isDefault' | 'label'> | null;
  paymentMethodLabel: string | null;
  shippingMethodLabel: string | null;
  shippingStatus: string;
  tracking: { carrier: string | null; number: string | null; url: string | null } | null;
  timeline: OrderTimelineEntry[];
  estimatedDeliveryAt: string | null;
  /** The server decides; the UI only renders what it is told is possible. */
  canCancel: boolean;
  canRequestReturn: boolean;
  invoiceUrl: string | null;
}

export interface ReturnSummary {
  id: string;
  returnNumber: string;
  orderNumber: string;
  status: string;
  resolution: string;
  requestedAt: string;
  itemCount: number;
}

export interface RefundSummary {
  id: string;
  refundNumber: string;
  orderNumber: string;
  amount: string;
  currency: string;
  status: string;
  method: string | null;
  requestedAt: string;
  completedAt: string | null;
}

export interface Review {
  id: string;
  customerName: string;
  rating: number;
  body: string | null;
  verifiedPurchase: boolean;
  createdAt: string;
  images: string[];
  adminReply: string | null;
  adminRepliedAt: string | null;
}

export interface ReviewSummary {
  average: number;
  count: number;
  /** Index 0 is one star. */
  distribution: [number, number, number, number, number];
}

export interface ShippingMethodOption {
  id: string;
  name: string;
  description: string | null;
  price: string;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
}

export interface PaymentMethodOption {
  provider: string;
  label: string;
  description: string | null;
  instructions: string | null;
}
