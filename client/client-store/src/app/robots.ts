import type { MetadataRoute } from 'next';
import { getPublishedStoreConfig } from '@/lib/api/store';
import { isStoreTrading } from '@/components/layout/store-gate';

/**
 * `robots.txt`.
 *
 * A store that is suspended, expired or still being provisioned disallows
 * everything: it has nothing to show, and letting a crawler index a
 * "temporarily unavailable" page means that is what appears in results long
 * after the store reopens.
 *
 * The disallow list mirrors the `noindex` headers in `next.config.ts`. Both are
 * kept because they do different jobs — one stops crawling, the other stops
 * indexing of anything reached by a link from elsewhere.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = await getPublishedStoreConfig();
  const origin = config.store.canonicalOrigin.replace(/\/$/, '');

  if (!isStoreTrading(config.status)) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/account',
          '/cart',
          '/checkout',
          '/wishlist',
          '/compare',
          '/track-order',
          '/login',
          '/register',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
          // Search result pages generate unbounded near-duplicate URLs.
          '/search',
          '/api/',
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
