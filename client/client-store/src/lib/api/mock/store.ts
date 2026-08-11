import type { Brand, Category, HomepageSection, ProductSummary, StoreConfig } from '@/types';
import {
  MOCK_HOMEPAGE_SECTIONS,
  MOCK_PRODUCTS,
  MOCK_STORE_CONFIG,
  PRODUCT_BY_ID,
} from './fixtures';
import { mockBrandsWithCounts, mockCategoriesWithCounts } from './products';

/**
 * The mock adapter.
 *
 * Every function here mirrors the signature of its live counterpart, so
 * switching `NEXT_PUBLIC_DATA_SOURCE` from `mock` to `live` changes no component
 * and no page — only which implementation the api module reaches for.
 *
 * Design preview used to live in this file, which is precisely why it only ever
 * worked on fixtures: a live store took the other branch and the override was
 * never reached. It now lives in `lib/design/preview.ts`, applied above both
 * adapters, so all 48 template × theme combinations are inspectable whichever
 * data source is in play.
 */

export async function mockStoreConfig(): Promise<StoreConfig> {
  return MOCK_STORE_CONFIG;
}

export async function mockHomepageSections(): Promise<HomepageSection[]> {
  return MOCK_HOMEPAGE_SECTIONS;
}

export async function mockCategories(): Promise<Category[]> {
  return mockCategoriesWithCounts();
}

export async function mockBrands(): Promise<Brand[]> {
  return mockBrandsWithCounts();
}

/** Preserves the caller's order, and drops ids that no longer resolve. */
export async function mockProductsByIds(ids: string[]): Promise<ProductSummary[]> {
  return ids
    .map((id) => PRODUCT_BY_ID.get(id))
    .filter((product): product is ProductSummary => product !== undefined);
}

export async function mockAllProducts(): Promise<ProductSummary[]> {
  return MOCK_PRODUCTS;
}
