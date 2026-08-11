import { PAGE_SIZE } from '@/config';
import type { ProductDetail, ProductSummary, Review, ReviewSummary } from '@/types';
import { buildProductDetail, buildReviews } from './fixtures/details';
import {
  CATEGORY_OF,
  MOCK_PRODUCTS,
  PRODUCT_BY_ID,
  PRODUCT_BY_SLUG,
  productsInCategory,
} from './fixtures';
import { rngFor } from './fixtures/random';

/**
 * Mock product detail, related products, bundles and reviews.
 *
 * Everything is derived deterministically from the catalogue, so a product
 * looks the same on every render and the detail page never contradicts the card
 * that linked to it.
 */

export async function mockProductDetail(slug: string): Promise<ProductDetail | null> {
  return buildProductDetail(slug);
}

/**
 * Related products.
 *
 * Same category first, then the same brand, then anything — which is roughly
 * what a real recommender falls back through, and it guarantees the rail is
 * never empty on a category with only one product in it.
 */
export async function mockRelatedProducts(productId: string, limit = 12): Promise<ProductSummary[]> {
  const product = PRODUCT_BY_ID.get(productId);
  if (!product) return [];

  const categoryId = CATEGORY_OF.get(productId);
  const sameCategory = categoryId ? productsInCategory(categoryId) : [];
  const sameBrand = product.brand
    ? MOCK_PRODUCTS.filter((candidate) => candidate.brand?.id === product.brand!.id)
    : [];

  const seen = new Set([productId]);
  const out: ProductSummary[] = [];

  for (const pool of [sameCategory, sameBrand, MOCK_PRODUCTS]) {
    for (const candidate of pool) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

/**
 * "Frequently bought together".
 *
 * Three items including the product itself, and a bundle price the **server**
 * calculates. The UI never adds these up: the discount is a commercial decision
 * and the browser is not the place it gets made.
 */
export async function mockFrequentlyBoughtTogether(
  productId: string,
): Promise<{ items: ProductSummary[]; bundlePrice: string; currency: string } | null> {
  const product = PRODUCT_BY_ID.get(productId);
  if (!product) return null;

  const related = (await mockRelatedProducts(productId, 8)).filter((item) => item.inStock);
  const rng = rngFor(`fbt:${productId}`);
  const companions = rng.sample(related, 2);
  if (companions.length < 2) return null;

  const items = [product, ...companions];
  const total = items.reduce(
    (sum, item) => sum + Number.parseFloat(item.salePrice ?? item.price),
    0,
  );

  return {
    items,
    // A modest bundle saving, rounded to the same precision as a price.
    bundlePrice: (total * 0.92).toFixed(2),
    currency: product.currency,
  };
}

export async function mockProductReviews(
  slug: string,
  query: { page?: number; sort?: 'recent' | 'rating_desc' | 'rating_asc' } = {},
): Promise<{
  items: Review[];
  summary: ReviewSummary;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
} | null> {
  const built = buildReviews(slug);
  if (!built) return null;

  const sorted = [...built.reviews];
  if (query.sort === 'rating_desc') sorted.sort((a, b) => b.rating - a.rating);
  if (query.sort === 'rating_asc') sorted.sort((a, b) => a.rating - b.rating);

  const pageSize = PAGE_SIZE.reviews;
  const page = Math.max(1, query.page ?? 1);
  const total = sorted.length;

  return {
    items: sorted.slice((page - 1) * pageSize, page * pageSize),
    summary: built.summary,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/**
 * Accepts a review and reports it as pending.
 *
 * Which is what the real endpoint does: a review is moderated before it is
 * published, so a submission that appeared instantly would be a lie about what
 * happens next.
 */
export async function mockSubmitReview(): Promise<{ status: 'pending' | 'published' }> {
  return { status: 'pending' };
}

/** Search suggestions: products, then the categories and brands that match. */
export async function mockSearchSuggestions(term: string, limit = 8) {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];

  const { CATEGORY_BY_SLUG, MOCK_BRANDS, ALL_CATEGORIES } = await import('./fixtures');

  const products = MOCK_PRODUCTS.filter(
    (product) =>
      product.name.toLowerCase().includes(needle) ||
      product.brand?.name.toLowerCase().includes(needle),
  ).slice(0, limit - 2);

  const categories = ALL_CATEGORIES.filter((category) =>
    category.name.toLowerCase().includes(needle),
  ).slice(0, 2);

  const brands = MOCK_BRANDS.filter((brand) => brand.name.toLowerCase().includes(needle)).slice(0, 2);

  void CATEGORY_BY_SLUG;

  return [
    ...products.map((product) => ({
      type: 'product' as const,
      id: product.id,
      label: product.name,
      href: `/product/${product.slug}`,
      imageUrl: product.primaryImage?.url ?? null,
      price: product.salePrice ?? product.price,
      meta: product.brand?.name ?? null,
    })),
    ...categories.map((category) => ({
      type: 'category' as const,
      id: category.id,
      label: category.name,
      href: `/category/${category.slug}`,
      imageUrl: null,
      price: null,
      meta: `${category.productCount} products`,
    })),
    ...brands.map((brand) => ({
      type: 'brand' as const,
      id: brand.id,
      label: brand.name,
      href: `/brand/${brand.slug}`,
      imageUrl: null,
      price: null,
      meta: 'Brand',
    })),
  ].slice(0, limit);
}

export { PRODUCT_BY_SLUG };
