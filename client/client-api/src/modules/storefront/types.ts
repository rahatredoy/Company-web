/**
 * The wire contract between this API and `client-store`.
 *
 * These interfaces are a deliberate mirror of `client-store/src/types/index.ts`,
 * which is the authority: it is what the storefront's components already consume,
 * so a field renamed here and not there is a blank page rather than a type error.
 * The two files are copies on purpose — the same reason nothing else in this repo
 * is shared through a workspace — so a change to one must be made to the other.
 *
 * Nothing internal belongs in these shapes. Cost price, stock counts, warehouse
 * ids, admin notes and moderation state are all read by the queries that build
 * them and none of them survive into a response.
 */

/**
 * A product sold by weight or volume, or null for one sold one at a time.
 *
 * Sent whole rather than as five loose fields so the storefront has one thing to
 * branch on: null means "render the plain card", and anything else carries
 * everything the picker needs — the rate's label, the sizes, and the floor the
 * shop will not weigh out less than.
 */
export interface MeasureSale {
  /** The base unit every number here is counted in: `g`, `ml` or `pc`. */
  unit: 'g' | 'ml' | 'pc';
  /** How much of it the price buys. 1000 = the price is per kilo. */
  pricingMeasure: number;
  /** Printed after the price: "Per 1kg", "Per 100g", "Per Piece". */
  pricingLabel: string;
  /** Floor on a line's total, in base units — the "(Min. 350gm)" on the card. */
  minMeasure: number | null;
  options: { label: string; measure: number }[];
}

export interface ProductImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  brand: { id: string; name: string; slug: string } | null;
  primaryImage: ProductImage | null;
  secondaryImage: ProductImage | null;
  price: string;
  salePrice: string | null;
  /** Server-computed, so the badge can never disagree with the price. */
  discountPercent: number | null;
  currency: string;
  ratingAverage: number;
  ratingCount: number;
  inStock: boolean;
  lowStock: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  keySpec: string | null;
  hasVariants: boolean;
  /**
   * What a one-click Add puts in the basket.
   *
   * A basket line is a variant — that is what holds the price and the stock a
   * checkout reserves — and a `simple` product owns exactly one, so a card can
   * add without asking the server anything. For a `variable` product this is
   * only the variant its page opens on; the card opens a picker instead.
   */
  defaultVariantId: string | null;
  /** The quantity a one-click Add starts at, so a "sold in threes" product does. */
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  /** Non-null when the card shows a measure picker instead of a plain Add. */
  measure: MeasureSale | null;
}

export interface VariantOption {
  attributeId: string;
  attributeName: string;
  slug: string;
  inputType: 'select' | 'color' | 'text' | 'number';
  values: { id: string; value: string; slug: string; colorHex: string | null }[];
}

export interface ProductVariantView {
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
  variants: ProductVariantView[];
  defaultVariantId: string | null;
  specifications: { groupName: string | null; label: string; value: string; isKeySpec: boolean }[];
  shippingInfo: string | null;
  returnInfo: string | null;
  isReturnable: boolean;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  measure: MeasureSale | null;
  seo: { title: string | null; description: string | null };
}

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  productCount: number;
  children: CategoryView[];
  breadcrumb: { name: string; slug: string }[];
  seo: { title: string | null; description: string | null };
}

/**
 * One row of the homepage's category showcase: an aisle, and the products in it.
 *
 * Ids rather than product summaries, deliberately. The storefront already
 * resolves every homepage product through the `?ids=` branch of the listing —
 * one call, one cache entry, shared with the rest of the page — so returning
 * decorated rows here would fetch the same products a second time and put a
 * price into an entry that is held longer than a price may be.
 */
export interface CategoryShowcaseRow {
  categoryId: string;
  productIds: string[];
}

/** One department of the showcase, with the aisles that have something in them. */
export interface CategoryShowcaseGroup {
  categoryId: string;
  rows: CategoryShowcaseRow[];
}

export interface BrandView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  productCount: number;
  seo: { title: string | null; description: string | null };
}

export type SortValue =
  | 'relevance'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'best_selling'
  | 'rating';

export interface FilterGroup {
  key: string;
  label: string;
  type: 'checkbox' | 'color' | 'range' | 'rating';
  options: { value: string; label: string; count: number; colorHex?: string | null }[];
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

export type HomepageSectionKind =
  | 'hero'
  | 'category_grid'
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
  | 'collection'
  | 'social_gallery'
  | 'recently_viewed';

export interface HomepageSectionView {
  id: string;
  type: HomepageSectionKind;
  title: string | null;
  subtitle: string | null;
  /** Type-specific, validated per type by the renderer; never executed. */
  config: Record<string, unknown>;
}

export interface CmsPageView {
  slug: string;
  title: string;
  excerpt: string | null;
  /** Sanitised on write, so it is safe to render as HTML. */
  bodyHtml: string | null;
  updatedAt: string;
  seo: { title: string | null; description: string | null };
}

export interface FaqView {
  id: string;
  question: string;
  answer: string;
  category: string | null;
}

export interface ReviewView {
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

export interface ReviewSummaryView {
  average: number;
  count: number;
  /** Index 0 is one star. */
  distribution: [number, number, number, number, number];
}
