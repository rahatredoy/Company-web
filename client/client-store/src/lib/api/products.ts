import 'server-only';
import { PAGE_SIZE } from '@/config';
import type { ProductListResult, SortValue } from '@/types';
import { storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

export interface ProductQuery {
  page?: number;
  pageSize?: number;
  sort?: SortValue;
  q?: string;
  category?: string;
  /**
   * Child categories ticked from the chips on a category page. Separate from
   * `category` because the page stays on the parent: the chips narrow the
   * listing, they do not replace it with the child's own page.
   */
  subcategories?: string[];
  brand?: string[];
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  sale?: boolean;
  /** Attribute facets, e.g. `{ colour: ['black'], size: ['m'] }`. */
  attributes?: Record<string, string[]>;
}

/**
 * The one listing call behind `/shop`, `/category/[slug]`, `/brand/[slug]` and
 * `/search`. They differ only in which filter is pre-applied, so they share a
 * query shape — and the server validates every value, including `sort`.
 */
export async function getProductList(query: ProductQuery): Promise<ProductListResult> {
  const { attributes, brand, subcategories, ...rest } = query;
  const { readCurrencyPreference } = await import('@/lib/locale/preference');

  return apiFetch<ProductListResult>('/api/v1/storefront/products', {
    ...(await storeCall()),
    // No cookie: this response is shared between visitors for the window below.
    // Listings move with stock and price, so they are held only briefly.
    revalidate: 60,
    tags: ['products'],
    query: {
      ...rest,
      pageSize: query.pageSize ?? PAGE_SIZE.shop,
      brand,
      // Travels under the same name it has in the URL, so a listing link and
      // the call behind it never drift apart.
      sub: subcategories,
      /*
       * Display currency travels as a query parameter, not a cookie. It has to
       * be part of the cache key — a shared cache entry keyed without it would
       * serve one visitor's currency to the next.
       */
      currency: await readCurrencyPreference(),
      // Facets travel as `attr.colour=black`, so the API can add attributes
      // without this client needing to know their names.
      ...Object.fromEntries(
        Object.entries(attributes ?? {}).map(([key, values]) => [`attr.${key}`, values]),
      ),
    },
  });
}

/**
 * Parses a listing URL into a validated query.
 *
 * Search params are visitor-controlled, so nothing is passed through raw: an
 * unknown `sort` falls back to relevance, page numbers are clamped, and prices
 * must be finite and positive.
 */
export function parseProductQuery(
  params: Record<string, string | string[] | undefined>,
  defaults: Partial<ProductQuery> = {},
): ProductQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const many = (value: string | string[] | undefined) =>
    value === undefined ? undefined : Array.isArray(value) ? value : value.split(',').filter(Boolean);

  /*
   * A page's own default is the fallback, not `relevance`.
   *
   * `defaults` is spread into the result below, so anything set unconditionally
   * after it wins — which silently threw away what the caller asked for. That
   * is what made `/best-sellers` sort by relevance and `/sale` list the entire
   * catalogue: both passed a default that was overwritten a line later. The
   * visitor's own `?sort=` still takes precedence over both.
   */
  const VALID_SORTS: SortValue[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'best_selling', 'rating'];
  const rawSort = first(params.sort);
  const sort = VALID_SORTS.includes(rawSort as SortValue)
    ? (rawSort as SortValue)
    : (defaults.sort ?? 'relevance');

  const number = (value: string | undefined) => {
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };

  const page = Math.max(1, Math.min(500, Number.parseInt(first(params.page) ?? '1', 10) || 1));

  // Anything not a known filter is treated as an attribute facet.
  const KNOWN = new Set(['page', 'sort', 'q', 'category', 'sub', 'brand', 'minPrice', 'maxPrice', 'rating', 'inStock', 'sale', 'template', 'theme']);
  const attributes: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (KNOWN.has(key)) continue;
    const values = many(value);
    if (values && values.length > 0) attributes[key] = values;
  }

  return {
    ...defaults,
    page,
    sort,
    q: first(params.q)?.trim() || undefined,
    category: defaults.category ?? first(params.category),
    subcategories: defaults.subcategories ?? many(params.sub),
    brand: defaults.brand ?? many(params.brand),
    minPrice: number(first(params.minPrice)),
    maxPrice: number(first(params.maxPrice)),
    rating: number(first(params.rating)),
    // Same reasoning as `sort`: fall back to the page's default rather than to
    // nothing, so `/sale` stays a sale listing when no filter is in the URL.
    inStock: first(params.inStock) === 'true' ? true : defaults.inStock,
    sale: first(params.sale) === 'true' ? true : defaults.sale,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}
