import 'server-only';
import { cache } from 'react';
import { isMockData, PAGE_SIZE } from '@/config';
import type { ProductDetail, ProductSummary, Review, ReviewSummary } from '@/types';
import { storeCall } from '@/lib/tenant';
import { readCurrencyPreference } from '@/lib/locale/preference';
import { apiFetch } from './client';

/**
 * Product detail reads.
 *
 * Same seam as the rest of `lib/api`: one function per endpoint, a mock branch
 * that is dynamically imported so a `live` build never bundles fixtures, and a
 * live branch whose signature is the contract the Commerce API has to satisfy.
 *
 * Every one of these is public and identical for every visitor, so they carry a
 * revalidation window and no cookie.
 */

export const getProductDetail = cache(async (slug: string): Promise<ProductDetail | null> => {
  if (isMockData) {
    const { mockProductDetail } = await import('./mock/product');
    const { convertPriced } = await import('./mock/currency');
    const detail = await mockProductDetail(slug);
    if (!detail) return null;

    // Live, the API returns prices already in the visitor's currency; the
    // fixture layer converts here so the selector is a control that works.
    return convertPriced(detail, await readCurrencyPreference());
  }

  return apiFetch<ProductDetail | null>(`/api/v1/storefront/products/${encodeURIComponent(slug)}`, {
    ...(await storeCall()),
    query: { currency: await readCurrencyPreference() },
    revalidate: 60,
    tags: ['products', `product:${slug}`],
    // "No such product" is a page to render, not a failure to throw.
    allowNotFound: true,
  });
});

export async function getRelatedProducts(productId: string, limit = 12): Promise<ProductSummary[]> {
  if (isMockData) {
    const { mockRelatedProducts } = await import('./mock/product');
    const { convertProducts } = await import('./mock/currency');
    return convertProducts(await mockRelatedProducts(productId, limit), await readCurrencyPreference());
  }

  return apiFetch<ProductSummary[]>(
    `/api/v1/storefront/products/${encodeURIComponent(productId)}/related`,
    {
      ...(await storeCall()),
      query: { limit, currency: await readCurrencyPreference() },
      revalidate: 300,
      tags: ['products'],
    },
  );
}

export interface BundleOffer {
  items: ProductSummary[];
  /** Server-calculated. The UI never adds these up itself. */
  bundlePrice: string;
  currency: string;
}

export async function getFrequentlyBoughtTogether(productId: string): Promise<BundleOffer | null> {
  if (isMockData) {
    const { mockFrequentlyBoughtTogether } = await import('./mock/product');
    const { convertProducts } = await import('./mock/currency');
    const bundle = await mockFrequentlyBoughtTogether(productId);
    if (!bundle) return null;

    const currency = await readCurrencyPreference();
    return { ...bundle, items: convertProducts(bundle.items, currency) };
  }

  return apiFetch<BundleOffer | null>(
    `/api/v1/storefront/products/${encodeURIComponent(productId)}/bundle`,
    {
      ...(await storeCall()),
      query: { currency: await readCurrencyPreference() },
      revalidate: 300,
      tags: ['products'],
      allowNotFound: true,
    },
  );
}

export interface ReviewPage {
  items: Review[];
  summary: ReviewSummary;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function getProductReviews(
  slug: string,
  query: { page?: number; sort?: 'recent' | 'rating_desc' | 'rating_asc' } = {},
): Promise<ReviewPage | null> {
  if (isMockData) {
    const { mockProductReviews } = await import('./mock/product');
    return mockProductReviews(slug, query);
  }

  return apiFetch<ReviewPage | null>(
    `/api/v1/storefront/products/${encodeURIComponent(slug)}/reviews`,
    {
      ...(await storeCall()),
      query: { page: query.page ?? 1, pageSize: PAGE_SIZE.reviews, sort: query.sort },
      revalidate: 120,
      tags: [`reviews:${slug}`],
      allowNotFound: true,
    },
  );
}
