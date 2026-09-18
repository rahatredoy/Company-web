'use server';

import { PAGE_SIZE } from '@/config';
import { getProductList, type ProductQuery } from '@/lib/api/products';
import { SORT_OPTIONS, type ProductSummary, type SortValue } from '@/types';

/**
 * The next batch of a listing — `/shop`, a category, a brand, a search.
 *
 * A Server Action rather than a fetch from the browser, for the reason
 * `loadCatalogPage` is one: the Commerce API identifies the store from the
 * hostname the call is made to, which `lib/tenant#storeCall` derives from the
 * incoming request. A client component would have to rebuild that for itself,
 * development-only `X-Store-Slug` header included, and one copy of that logic is
 * what keeps "load more" from quietly reading a different store.
 *
 * It returns the products and the count and **not the facets** — the filter rail
 * is drawn once, from the first batch, and re-sending several kilobytes of
 * option counts with every twenty cards is most of what an infinite listing
 * would otherwise cost.
 *
 * The query arrives from the browser, so none of it is trusted: an action is a
 * public endpoint whoever is calling it. Every field below is re-clamped here,
 * and the API validates the lot again — an unknown sort falls back to relevance,
 * an invented price band is dropped, an unknown category slug is answered with
 * an empty listing rather than with the whole shop.
 */
const SORTS = new Set<string>(SORT_OPTIONS.map((option) => option.value));

/** One visitor-supplied string: trimmed, length-capped, or gone. */
function word(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function words(value: unknown, max: number, cap = 24): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const list = value
    .map((entry) => word(entry, max))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, cap);

  return list.length > 0 ? list : undefined;
}

function positive(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** `{ size: ['m'] }` — an attribute slug and the values ticked under it. */
function facets(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const parsed: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    const slug = word(key, 90);
    const values = words(raw, 140);
    if (slug && values) parsed[slug] = values;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export async function loadListingPage(input: {
  page: number;
  query: ProductQuery;
}): Promise<{ items: ProductSummary[]; total: number }> {
  const source = (input?.query ?? {}) as Record<string, unknown>;
  const page = Math.min(500, Math.max(1, Math.floor(Number(input?.page) || 1)));
  const sort = (SORTS.has(String(source.sort)) ? source.sort : 'relevance') as SortValue;

  const result = await getProductList({
    page,
    pageSize: PAGE_SIZE.shop,
    sort,
    q: word(source.q, 120),
    category: word(source.category, 220),
    subcategories: words(source.subcategories, 220),
    brand: words(source.brand, 220),
    priceBands: words(source.priceBands, 24),
    offers: words(source.offers, 40),
    minPrice: positive(source.minPrice),
    maxPrice: positive(source.maxPrice),
    rating: positive(source.rating),
    // Only ever switched on, the way the API reads these two: `false` is the
    // absence of a filter, not a filter for out-of-stock products.
    inStock: source.inStock === true ? true : undefined,
    sale: source.sale === true ? true : undefined,
    attributes: facets(source.attributes),
  });

  return { items: result.items, total: result.meta.total };
}
