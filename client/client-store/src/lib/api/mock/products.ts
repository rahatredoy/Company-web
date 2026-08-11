import { PAGE_SIZE } from '@/config';
import type { Brand, Category, FilterGroup, ProductListResult, ProductSummary } from '@/types';
import type { ProductQuery } from '../products';
import {
  BRAND_BY_SLUG,
  CATEGORY_BY_SLUG,
  CATEGORY_OF,
  MOCK_BRANDS,
  MOCK_CATEGORIES,
  MOCK_PRODUCTS,
  PARENT_OF,
} from './fixtures';

/**
 * Mock listing.
 *
 * Filters, facets, sorts and paginates in memory so the listing UI — counts,
 * chips, sorting, pagination and every empty state — can be built and reviewed
 * exactly as it will behave against the real endpoint. Only ever reached
 * through the mock adapter.
 */

/** A parent category covers its children; a child covers only itself. */
function categoryIdsFor(slug: string): Set<string> | null {
  const category = CATEGORY_BY_SLUG.get(slug);
  if (!category) return null;
  return new Set([category.id, ...category.children.map((child) => child.id)]);
}

/** Everything covered by the chips a visitor has ticked, unknown slugs aside. */
function subcategoryIdsFor(slugs: string[]): Set<string> {
  const ids = new Set<string>();
  for (const slug of slugs) {
    for (const id of categoryIdsFor(slug) ?? []) ids.add(id);
  }
  return ids;
}

function priceOf(product: ProductSummary): number {
  return Number.parseFloat(product.salePrice ?? product.price);
}

type FacetKey = 'brand' | 'price' | 'rating' | 'inStock' | 'sale';

/**
 * Applies the sidebar filters, optionally leaving one group out.
 *
 * Leaving a group out is what keeps the sidebar still. A group's own counts are
 * taken from the products the *other* groups left, so ticking one brand narrows
 * the grid without deleting every other brand from the list the visitor is
 * still reading — and unticking it is always one click away.
 */
function applyFacets(pool: ProductSummary[], query: ProductQuery, except?: FacetKey): ProductSummary[] {
  let items = pool;

  if (except !== 'brand' && query.brand?.length) {
    const brands = new Set(query.brand);
    items = items.filter((product) => product.brand && brands.has(product.brand.slug));
  }
  if (except !== 'sale' && query.sale) items = items.filter((product) => product.salePrice !== null);
  if (except !== 'inStock' && query.inStock) items = items.filter((product) => product.inStock);
  if (except !== 'rating' && query.rating) items = items.filter((product) => product.ratingAverage >= query.rating!);
  if (except !== 'price' && query.minPrice !== undefined) {
    items = items.filter((product) => priceOf(product) >= query.minPrice!);
  }
  if (except !== 'price' && query.maxPrice !== undefined) {
    items = items.filter((product) => priceOf(product) <= query.maxPrice!);
  }

  return items;
}

/**
 * Facets, each computed from the products the *other* filters left.
 *
 * That ordering is the point: a count has to describe what clicking the option
 * would actually produce, or the visitor picks "Nike (14)" and gets three.
 */
function buildFilters(base: ProductSummary[], query: ProductQuery): FilterGroup[] {
  if (base.length === 0) return [];

  const groups: FilterGroup[] = [];

  const brandPool = applyFacets(base, query, 'brand');
  const brandCounts = new Map<string, number>();
  for (const product of brandPool) {
    if (product.brand) brandCounts.set(product.brand.slug, (brandCounts.get(product.brand.slug) ?? 0) + 1);
  }
  // A ticked brand stays listed even when another filter has left it nothing,
  // or it becomes a filter with no way to untick it.
  for (const slug of query.brand ?? []) if (!brandCounts.has(slug)) brandCounts.set(slug, 0);

  // Only offer a facet that can narrow something. A brand filter listing the
  // one brand in the result set is a control with no effect.
  if (brandCounts.size > 1) {
    groups.push({
      key: 'brand',
      label: 'Brand',
      type: 'checkbox',
      options: [...brandCounts.entries()]
        .map(([slug, count]) => ({
          value: slug,
          label: BRAND_BY_SLUG.get(slug)?.name ?? slug,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    });
  }

  const pricePool = applyFacets(base, query, 'price');
  if (pricePool.length > 0) {
    const prices = pricePool.map(priceOf);
    groups.push({
      key: 'price',
      label: 'Price',
      type: 'range',
      options: [],
      min: Math.floor(Math.min(...prices)),
      max: Math.ceil(Math.max(...prices)),
    });
  }

  const ratingPool = applyFacets(base, query, 'rating');
  const ratingOptions = [4, 3, 2]
    .map((min) => ({
      value: String(min),
      label: `${min} stars & up`,
      count: ratingPool.filter((product) => product.ratingAverage >= min).length,
    }))
    .filter((option) => option.count > 0 || option.value === String(query.rating));

  if (ratingOptions.length > 0) {
    groups.push({ key: 'rating', label: 'Customer rating', type: 'rating', options: ratingOptions });
  }

  const stockPool = applyFacets(base, query, 'inStock');
  const inStockCount = stockPool.filter((product) => product.inStock).length;
  if (query.inStock || (inStockCount > 0 && inStockCount < stockPool.length)) {
    groups.push({
      key: 'inStock',
      label: 'Availability',
      type: 'checkbox',
      options: [{ value: 'true', label: 'In stock only', count: inStockCount }],
    });
  }

  const salePool = applyFacets(base, query, 'sale');
  const saleCount = salePool.filter((product) => product.salePrice !== null).length;
  if (query.sale || (saleCount > 0 && saleCount < salePool.length)) {
    groups.push({
      key: 'sale',
      label: 'Offers',
      type: 'checkbox',
      options: [{ value: 'true', label: 'On sale', count: saleCount }],
    });
  }

  return groups;
}

export async function mockProductList(query: ProductQuery): Promise<ProductListResult> {
  // What the page itself is about — category, chips, search term. The sidebar
  // filters are applied after this, per group, so their counts stay honest.
  let base = [...MOCK_PRODUCTS];

  if (query.category) {
    const ids = categoryIdsFor(query.category);
    // An unknown category yields nothing rather than everything: silently
    // returning the whole catalogue would hide a broken link.
    base = ids ? base.filter((product) => ids.has(CATEGORY_OF.get(product.id) ?? '')) : [];
  }

  if (query.subcategories?.length) {
    const ids = subcategoryIdsFor(query.subcategories);
    base = ids.size > 0 ? base.filter((product) => ids.has(CATEGORY_OF.get(product.id) ?? '')) : [];
  }

  if (query.q) {
    const needle = query.q.toLowerCase();
    base = base.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        product.brand?.name.toLowerCase().includes(needle) ||
        product.keySpec?.toLowerCase().includes(needle),
    );
  }

  const filters = buildFilters(base, query);
  const items = [...applyFacets(base, query)];

  switch (query.sort) {
    case 'price_asc':
      items.sort((a, b) => priceOf(a) - priceOf(b));
      break;
    case 'price_desc':
      items.sort((a, b) => priceOf(b) - priceOf(a));
      break;
    case 'rating':
      items.sort((a, b) => b.ratingAverage - a.ratingAverage);
      break;
    case 'best_selling':
      items.sort((a, b) => b.ratingCount - a.ratingCount);
      break;
    case 'newest':
      items.sort((a, b) => Number(b.isNewArrival) - Number(a.isNewArrival));
      break;
    default:
      break;
  }

  const pageSize = query.pageSize ?? PAGE_SIZE.shop;
  const page = query.page ?? 1;
  const total = items.length;

  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    filters,
    appliedFilters: {
      ...(query.subcategories?.length ? { sub: query.subcategories } : {}),
      ...(query.brand?.length ? { brand: query.brand } : {}),
      ...(query.rating ? { rating: [String(query.rating)] } : {}),
      ...(query.inStock ? { inStock: ['true'] } : {}),
      ...(query.sale ? { sale: ['true'] } : {}),
    },
  };
}

export async function mockCategoryBySlug(slug: string): Promise<Category | null> {
  const found = CATEGORY_BY_SLUG.get(slug);
  if (!found) return null;

  const parent = PARENT_OF.get(found.id);

  return {
    ...found,
    // Counts come from the catalogue rather than the fixture's own number, so a
    // category page never claims 42 products and then lists nine.
    productCount: (await mockProductList({ category: slug, pageSize: 1 })).meta.total,
    breadcrumb: parent ? [{ name: parent.name, slug: parent.slug }] : [],
  };
}

export async function mockBrandBySlug(slug: string): Promise<Brand | null> {
  const brand = BRAND_BY_SLUG.get(slug);
  if (!brand) return null;

  return {
    ...brand,
    productCount: MOCK_PRODUCTS.filter((product) => product.brand?.id === brand.id).length,
  };
}

/** Categories with their real product counts, for the index and the menus. */
export async function mockCategoriesWithCounts(): Promise<Category[]> {
  const counted = await Promise.all(
    MOCK_CATEGORIES.map(async (category) => ({
      ...category,
      productCount: (await mockProductList({ category: category.slug, pageSize: 1 })).meta.total,
      children: await Promise.all(
        category.children.map(async (child) => ({
          ...child,
          productCount: (await mockProductList({ category: child.slug, pageSize: 1 })).meta.total,
        })),
      ),
    })),
  );

  return counted;
}

export async function mockBrandsWithCounts(): Promise<Brand[]> {
  return MOCK_BRANDS.map((brand) => ({
    ...brand,
    productCount: MOCK_PRODUCTS.filter((product) => product.brand?.id === brand.id).length,
  }));
}
