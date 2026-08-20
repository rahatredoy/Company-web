import 'server-only';
import { cache } from 'react';
import type {
  Brand,
  Category,
  CategoryShowcaseGroup,
  HomepageSection,
  ProductSummary,
} from '@/types';
import { storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

/**
 * Public catalogue reads.
 *
 * All of these are identical for every visitor, so they carry a revalidation
 * window and a cache tag. Nothing visitor-specific — a cart, an account, an
 * order — is ever fetched through this module, because a shared cache entry
 * holding one customer's data would be served to the next.
 *
 * For the same reason no cookie is forwarded: a request carrying a visitor's
 * session whose response goes into a shared cache is that bug waiting to
 * happen, and none of these endpoints has anything a session would unlock.
 */

async function publicOptions(tags: string[], revalidate = 120) {
  return {
    ...(await storeCall()),
    revalidate,
    tags,
  };
}

export const getHomepageSections = cache(async (): Promise<HomepageSection[]> => {
  return apiFetch<HomepageSection[]>('/api/v1/storefront/home', await publicOptions(['homepage']));
});

export const getCategories = cache(async (): Promise<Category[]> => {
  return apiFetch<Category[]>('/api/v1/storefront/categories', await publicOptions(['categories'], 300));
});

export const getBrands = cache(async (): Promise<Brand[]> => {
  return apiFetch<Brand[]>('/api/v1/storefront/brands', await publicOptions(['brands'], 300));
});

/**
 * Which products head each aisle of the "shop by category" block.
 *
 * One call for the whole block, however many departments it draws. Asking the
 * listing endpoint per aisle instead would have been a dozen requests, each one
 * making the API count the aisle and build a filter panel nothing renders.
 *
 * Scalar arguments rather than one options object, because `cache` keys on
 * argument *identity*: an object literal is a new reference on every call, so two
 * sections asking the same question would each pay for it.
 *
 * Tagged with both `categories` and `products` — the answer moves when either
 * the tree or the catalogue does, and it holds ids rather than prices, so its
 * window is the homepage's rather than a listing's.
 */
export const getCategoryShowcase = cache(
  async (
    /** The categories the block names, comma-separated; empty for the store's own order. */
    ids: string,
    /** Which department in that order this block starts at — see `offset` on the API. */
    offset: number,
    categories: number,
    rows: number,
    perRow: number,
  ): Promise<CategoryShowcaseGroup[]> => {
    return apiFetch<CategoryShowcaseGroup[]>('/api/v1/storefront/categories/showcase', {
      ...(await publicOptions(['categories', 'products'])),
      // An empty string is dropped by `buildUrl`, so the API sees no `ids` at all
      // rather than an empty list it would have to decide the meaning of.
      query: { ids, offset, categories, rows, perRow },
    });
  },
);

/**
 * Products already resolved during **this** render, by id.
 *
 * `cache` makes the map request-scoped, which is the whole point: it must not
 * outlive the render, because a summary carries a price and a stock badge and
 * two different visitors may be quoted different currencies. React drops it when
 * the request ends, so there is nothing here to leak into the next one.
 */
const resolvedSummaries = cache(() => new Map<string, ProductSummary>());

/**
 * The API caps `?ids=` at sixty per call, so a homepage naming more than that is
 * split. Sixty is the API's own limit and this must not exceed it — a longer
 * list is silently truncated on the far side, which would drop products off the
 * end of a rail with no error anywhere.
 */
const ID_BATCH = 60;

/**
 * Resolves the products a homepage section names.
 *
 * Sections store ids rather than embedded copies, so a price or stock change is
 * reflected on the homepage without anyone re-saving the section.
 *
 * **Batched across the whole render.** Each section used to fetch its own rail,
 * so a homepage with a hero rail, three grids, a tabbed block of four and a deal
 * was nine round trips to resolve one page — nine requests, each of which made
 * the API decorate its own rows with images, stock and specs. They ask for
 * different products, but they ask the same *question*, and the answer to sixty
 * of them costs barely more than the answer to eight.
 *
 * `primeProductSummaries` collects every id on the page and fills the map in one
 * call; each section then finds its products already there. A section that names
 * an id nobody primed still works — it fetches, exactly as before — so a new
 * section type cannot break by forgetting to register itself.
 */
export async function getProductsByIds(ids: string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];

  const store = resolvedSummaries();
  const missing = [...new Set(ids.filter((id) => !store.has(id)))];
  if (missing.length > 0) await loadSummaries(missing, store);

  // In the order the section named them: the owner's arrangement is the point.
  return ids.map((id) => store.get(id)).filter((item): item is ProductSummary => item !== undefined);
}

/**
 * Fetches every product the page will need, before any section renders.
 *
 * Called once from the homepage. Sections stay unchanged — they still ask for
 * their own ids — but by the time they do, the answer is already in hand.
 */
export async function primeProductSummaries(ids: string[]): Promise<void> {
  const store = resolvedSummaries();
  const missing = [...new Set(ids.filter((id) => id && !store.has(id)))];
  if (missing.length > 0) await loadSummaries(missing, store);
}

async function loadSummaries(ids: string[], store: Map<string, ProductSummary>): Promise<void> {
  const { readCurrencyPreference } = await import('@/lib/locale/preference');
  const [options, currency] = await Promise.all([
    publicOptions(['products'], 60),
    readCurrencyPreference(),
  ]);

  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_BATCH) {
    batches.push(ids.slice(index, index + ID_BATCH));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      apiFetch<ProductSummary[]>('/api/v1/storefront/products', {
        ...options,
        // Part of the cache key, deliberately — see the note in `products.ts`.
        query: { ids: batch, currency },
      }),
    ),
  );

  for (const item of results.flat()) store.set(item.id, item);
}
