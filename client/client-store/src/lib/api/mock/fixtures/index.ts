/**
 * Fixtures barrel.
 *
 * These exist so the storefront can be built and reviewed before every commerce
 * endpoint is written. They are reached **only** through the mock adapter in
 * `lib/api/mock/`, which is dynamically imported and only when
 * `NEXT_PUBLIC_DATA_SOURCE=mock` — so a production build never bundles them, and
 * no component ever imports this directory directly.
 */

export * from './images';
export * from './random';
export { MOCK_CATEGORIES, ALL_CATEGORIES, CATEGORY_BY_ID, CATEGORY_BY_SLUG, PARENT_OF } from './categories';
export { MOCK_BRANDS, BRAND_BY_ID, BRAND_BY_SLUG } from './brands';
export {
  MOCK_PRODUCTS,
  PRODUCT_BY_ID,
  PRODUCT_BY_SLUG,
  CATEGORY_OF,
  productsInCategory,
  productsForBrand,
  idsOf,
  idsWhere,
} from './products';
export { MOCK_STORE_CONFIG } from './store';
export { MOCK_HOMEPAGE_SECTIONS } from './homepage';
