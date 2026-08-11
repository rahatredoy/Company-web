import type { MetadataRoute } from 'next';
import { getPublishedStoreConfig } from '@/lib/api/store';
import { getBrands, getCategories } from '@/lib/api/catalog';
import { getProductList } from '@/lib/api/products';

/**
 * The sitemap.
 *
 * Built from `getPublishedStoreConfig`, never `getStoreConfig` — a design
 * preview must not be able to influence anything a crawler reads, and the
 * canonical origin has to be the store's published domain rather than whatever
 * host this request happened to arrive on.
 *
 * Only public, indexable routes are listed. Cart, checkout, account, wishlist,
 * compare and search are excluded here and disallowed in `robots.ts`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = await getPublishedStoreConfig();
  const origin = config.store.canonicalOrigin.replace(/\/$/, '');
  const url = (path: string) => `${origin}${path}`;

  const [categories, brands, products] = await Promise.all([
    getCategories(),
    getBrands(),
    // A cap, deliberately. A catalogue of a hundred thousand products needs a
    // paginated sitemap index, not one document — and quietly truncating
    // without saying so is how that requirement stays unnoticed.
    getProductList({ page: 1, pageSize: 1000, sort: 'newest' }),
  ]);

  if (products.meta.total > products.items.length) {
    console.warn(
      `[storefront] sitemap lists ${products.items.length} of ${products.meta.total} products; ` +
        'a sitemap index is needed above this size.',
    );
  }

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: url('/'), changeFrequency: 'daily', priority: 1 },
    { url: url('/shop'), changeFrequency: 'daily', priority: 0.9 },
    { url: url('/categories'), changeFrequency: 'weekly', priority: 0.7 },
    { url: url('/brands'), changeFrequency: 'weekly', priority: 0.6 },
    { url: url('/new-arrivals'), changeFrequency: 'daily', priority: 0.7 },
    { url: url('/best-sellers'), changeFrequency: 'daily', priority: 0.7 },
    { url: url('/sale'), changeFrequency: 'daily', priority: 0.7 },
    { url: url('/featured'), changeFrequency: 'weekly', priority: 0.6 },
    { url: url('/contact'), changeFrequency: 'yearly', priority: 0.4 },
    { url: url('/faq'), changeFrequency: 'monthly', priority: 0.5 },
    { url: url('/track-order'), changeFrequency: 'yearly', priority: 0.3 },
  ];

  return [
    ...staticRoutes,
    ...config.policyPages.map((page) => ({
      url: url(`/page/${page.slug}`),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
    ...categories.map((category) => ({
      url: url(`/category/${category.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...categories.flatMap((category) =>
      category.children.map((child) => ({
        url: url(`/category/${child.slug}`),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ),
    ...brands.map((brand) => ({
      url: url(`/brand/${brand.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
    ...products.items.map((product) => ({
      url: url(`/product/${product.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
