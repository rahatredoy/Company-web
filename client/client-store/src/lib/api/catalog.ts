import 'server-only';
import { cache } from 'react';
import { isMockData } from '@/config';
import type { Brand, Category, HomepageSection, ProductSummary } from '@/types';
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
  if (isMockData) {
    const { mockHomepageSections } = await import('./mock/store');
    return mockHomepageSections();
  }
  return apiFetch<HomepageSection[]>('/api/v1/storefront/home', await publicOptions(['homepage']));
});

export const getCategories = cache(async (): Promise<Category[]> => {
  if (isMockData) {
    const { mockCategories } = await import('./mock/store');
    return mockCategories();
  }
  return apiFetch<Category[]>('/api/v1/storefront/categories', await publicOptions(['categories'], 300));
});

export const getBrands = cache(async (): Promise<Brand[]> => {
  if (isMockData) {
    const { mockBrands } = await import('./mock/store');
    return mockBrands();
  }
  return apiFetch<Brand[]>('/api/v1/storefront/brands', await publicOptions(['brands'], 300));
});

/**
 * Resolves the products a homepage section names.
 *
 * Sections store ids rather than embedded copies, so a price or stock change is
 * reflected on the homepage without anyone re-saving the section.
 */
export async function getProductsByIds(ids: string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];

  if (isMockData) {
    const { mockProductsByIds } = await import('./mock/store');
    const { convertProducts } = await import('./mock/currency');
    const { readCurrencyPreference } = await import('@/lib/locale/preference');
    // Live, the API converts and returns prices already in the visitor's
    // currency; the fixture layer has to do it here to make the selector real.
    return convertProducts(await mockProductsByIds(ids), await readCurrencyPreference());
  }

  const { readCurrencyPreference } = await import('@/lib/locale/preference');

  return apiFetch<ProductSummary[]>('/api/v1/storefront/products', {
    ...(await publicOptions(['products'], 60)),
    // Part of the cache key, deliberately — see the note in `products.ts`.
    query: { ids, currency: await readCurrencyPreference() },
  });
}
