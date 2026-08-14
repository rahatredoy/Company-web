import 'server-only';
import { cache } from 'react';
import type { StoreConfig } from '@/types';
import { storeCall } from '@/lib/tenant';
import { applyDesignPreview, readDesignPreview } from '@/lib/design/preview';
import { apiFetch } from './client';

/**
 * Store configuration: brand, design, navigation, contact, policies, payment.
 *
 * Read on every single page render, so it is wrapped in React's `cache` — one
 * fetch per request no matter how many components ask for it — and cached at
 * the fetch layer for a short window on top of that.
 *
 * Two entry points, and the difference matters:
 *
 * - `getPublishedStoreConfig` is what the store actually publishes. Identical
 *   for every visitor, so it is the one thing safe to put in a shared cache,
 *   and the only one that may reach anything indexable — canonical URLs, the
 *   sitemap, structured data.
 * - `getStoreConfig` is that with the visitor's own design preview laid over
 *   the top. It is what the page renders.
 */

/** The store's own published design. Never carries a preview. */
export const getPublishedStoreConfig = cache(async (): Promise<StoreConfig> => {
  return apiFetch<StoreConfig>('/api/v1/storefront/config', {
    ...(await storeCall()),
    /*
     * No `cookieHeader`. This response is shared across every visitor of this
     * store for the revalidation window, and putting a per-visitor cookie into
     * a request whose response lands in a shared cache is how one customer's
     * data ends up in the next customer's page. There is nothing visitor-
     * specific in store configuration for a cookie to unlock anyway.
     */
    revalidate: 60,
    tags: ['storefront-config'],
  });
});

/**
 * What the page renders: the published configuration plus whatever design the
 * visitor is previewing in their own browser.
 */
export const getStoreConfig = cache(async (): Promise<StoreConfig> => {
  const published = await getPublishedStoreConfig();
  return applyDesignPreview(published, await readDesignPreview());
});
