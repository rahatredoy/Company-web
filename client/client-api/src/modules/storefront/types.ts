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
  | 'text';

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
