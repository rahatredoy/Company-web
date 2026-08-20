'use server';

import { PAGE_SIZE } from '@/config';
import { getProductList } from '@/lib/api/products';
import { SORT_OPTIONS, type ProductSummary, type SortValue } from '@/types';

/**
 * The next page of a paged catalogue listing.
 *
 * A Server Action rather than a fetch from the browser, for the reason the whole
 * `lib/api` layer is server-side: the Commerce API identifies the store from the
 * hostname the call is made to, which `lib/tenant#storeCall` derives from the
 * incoming request and a client component would have to rebuild for itself —
 * including the development-only `X-Store-Slug` header. One copy of that logic
 * is what keeps a "load more" from quietly reading the wrong store.
 *
 * It reads nothing a visitor cannot already see: this is the same published
 * listing `/shop` serves, through the same query, with no cookie attached. Both
 * arguments are visitor-controlled all the same, so both are clamped here rather
 * than trusted — an action is a public endpoint, whoever is calling it.
 */
const SORTS = new Set<string>(SORT_OPTIONS.map((option) => option.value));

export async function loadCatalogPage(input: {
  page: number;
  sort?: string;
  /**
   * Narrows every batch to one category and its descendants, which is what the
   * product page's "more from this department" grid pages through. Absent, the
   * whole shop is read, exactly as the homepage feed always has.
   */
  category?: string;
}): Promise<{ items: ProductSummary[]; total: number }> {
  const page = Math.min(500, Math.max(1, Math.floor(Number(input.page) || 1)));
  const sort = (SORTS.has(input.sort ?? '') ? input.sort : 'newest') as SortValue;

  // A slug and nothing else. It is clamped to the length the listing accepts
  // rather than trusted, for the reason `page` and `sort` above are: an action
  // is a public endpoint whoever is calling it. An unknown slug is answered
  // with an empty listing by the API, never with the whole catalogue.
  const slug = typeof input.category === 'string' ? input.category.trim().slice(0, 220) : '';
  const category = slug.length > 0 ? slug : undefined;

  const result = await getProductList({ page, pageSize: PAGE_SIZE.home, sort, category });

  // Only the products and the count: the facets a listing page draws its filter
  // rail from are several kilobytes the homepage has nothing to do with.
  return { items: result.items, total: result.meta.total };
}
