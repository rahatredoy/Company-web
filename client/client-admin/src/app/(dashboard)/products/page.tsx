import type { Metadata } from 'next';
import {
  ProductManager,
  type ProductFilterState,
  type ProductSort,
} from '@/components/admin/product-manager';
import {
  currentStoreSlug,
  serverGet,
  serverGetAll,
  serverGetListed,
  serverGetOptional,
} from '@/lib/server-api';
import { BATCH_SIZE, PRODUCT_LIST_SORT } from '@/lib/list';
import { storefrontUrl } from '@/lib/env';
import {
  can,
  type BrandRow,
  type CategoryRow,
  type ProductRow,
  type ProductStats,
  type SessionResponse,
  type StoreSettingsRow,
} from '@/lib/types';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';

/**
 * Enough for the filter and the quick-edit selects. These lists fill a `<select>`,
 * and one missing its second hundred silently cannot file a product where it
 * belongs — so they are read whole rather than a page at a time.
 */
const REFERENCE_CAP = 5;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = single(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };

  const filters: ProductFilterState = {
    search: single('search') ?? '',
    status: oneOf('status', ['all', 'active', 'draft', 'inactive'] as const, 'all'),
    categoryId: single('category') ?? '',
    brandId: single('brand') ?? '',
    stock: oneOf('stock', ['all', 'in_stock', 'low', 'out', 'untracked'] as const, 'all'),
    featured: oneOf('featured', ['all', 'yes', 'no'] as const, 'all'),
    // The fallbacks come from `lib/list.ts`, not from `PRODUCT_DEFAULTS`: that
    // object lives in a `'use client'` module and arrives here as a client
    // reference, so `.sort` was `undefined` and the URL said so.
    sort: oneOf(
      'sort',
      ['createdAt', 'updatedAt', 'name', 'price', 'sold', 'stock'] as const satisfies readonly ProductSort[],
      PRODUCT_LIST_SORT.sort,
    ),
    order: oneOf('order', ['asc', 'desc'] as const, PRODUCT_LIST_SORT.order),
  };

  const [session, slug, stats, categories, brands, settings, first] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    currentStoreSlug(),
    // A card missing beats the whole screen failing, so the tally is optional.
    serverGetOptional<ProductStats>('/api/v1/admin/products/stats'),
    serverGetAll<CategoryRow>('/api/v1/admin/categories', {}, { maxBatches: REFERENCE_CAP }),
    serverGetAll<BrandRow>('/api/v1/admin/brands', {}, { maxBatches: REFERENCE_CAP }),
    // Only for the create panel's measure picker; optional, so a settings blip
    // cannot stop the catalogue from opening.
    serverGetOptional<StoreSettingsRow>('/api/v1/admin/settings'),
    /*
     * The **first batch only**, and no cursor — which is what makes the API count
     * the filtered catalogue and return `total`. Every batch after this one is
     * fetched in the browser by cursor, and none of them pays for that count
     * again.
     *
     * Rendering it here rather than in the browser is what puts a filled table in
     * the first response: the reader sees rows before any JavaScript has run.
     */
    serverGetListed<ProductRow>('/api/v1/admin/products', {
      pageSize: BATCH_SIZE,
      search: filters.search || undefined,
      status: filters.status,
      categoryId: filters.categoryId || undefined,
      brandId: filters.brandId || undefined,
      stock: filters.stock,
      featured: filters.featured,
      sort: filters.sort,
      order: filters.order,
    }),
  ]);

  const admin = session.authenticated ? session.admin : null;

  return (
    <ProductManager
      initial={{ rows: first.data, meta: first.meta }}
      stats={stats}
      categories={categories.map((row) => ({ id: row.id, name: row.name, parentId: row.parentId }))}
      brands={brands.map((row) => ({ id: row.id, name: row.name }))}
      currency={session.authenticated ? session.store.currency : 'USD'}
      permissions={{
        create: can(admin, 'products.create'),
        update: can(admin, 'products.update'),
        delete: can(admin, 'products.delete'),
      }}
      storefrontBase={slug ? storefrontUrl(slug) : null}
      storeMeasureOptions={settings?.measureOptions}
      filters={filters}
      openCreate={single('new') === '1'}
    />
  );
}
