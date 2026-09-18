import type { FastifyInstance } from 'fastify';
import { redis } from './redis';
import { logger } from './logger';

/**
 * Every key is prefixed with the tenant reference. A cache key that could ever
 * be shared between two stores would be a data leak with a very long tail, so
 * the tenant is baked into the helper rather than left to each call site.
 */
export function tenantKey(tenantRef: string, ...parts: string[]): string {
  return `t:${tenantRef}:${parts.join(':')}`;
}

/**
 * Read-through cache for public storefront reads.
 *
 * Only ever used for data that is identical for every visitor — store config,
 * navigation, category trees, product listings. A response that depends on who
 * is asking (a cart, an account) must never pass through here.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (error) {
    // A cache outage must degrade to slow, never to broken.
    logger.warn({ err: (error as Error).message, key }, 'cache read failed');
  }

  const value = await load();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    logger.warn({ err: (error as Error).message, key }, 'cache write failed');
  }

  return value;
}

/**
 * Drops every cached read for one store.
 *
 * Called after any admin write, so a design change or a new product is visible
 * immediately rather than after a TTL. Uses SCAN rather than KEYS — this runs on
 * a shared Redis and a blocking keyspace walk would stall every other store.
 */
export async function invalidateTenantCache(tenantRef: string, ...parts: string[]): Promise<void> {
  const pattern = `${tenantKey(tenantRef, ...parts)}${parts.length > 0 ? ':*' : '*'}`;

  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');

    // The prefix itself is a valid key when no sub-parts were given.
    if (parts.length > 0) await redis.del(tenantKey(tenantRef, ...parts));
  } catch (error) {
    logger.warn({ err: (error as Error).message, pattern }, 'cache invalidation failed');
  }
}

/** Everything the public surface caches lives under this one sub-prefix. */
export const STOREFRONT_CACHE_SCOPE = 'storefront';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * A write that changes nothing a shopper can read — a product's private
     * note. Opts the route out of `invalidateStorefrontOnWrite`, which would
     * otherwise drop the store's whole catalogue cache on every save.
     */
    storefrontUnaffected?: boolean;
  }
}

/**
 * Drops this store's storefront cache after any successful admin write.
 *
 * Registered once per admin module rather than called from each handler,
 * because "remember to invalidate" is a rule that holds right up until somebody
 * adds a route — and the failure is invisible for a whole TTL, on somebody
 * else's shop. A hook cannot be forgotten by a route that does not exist yet.
 *
 * `onResponse` runs after the reply has been sent, so this costs the request
 * nothing, and a failed write (4xx/5xx) changed nothing worth dropping.
 */
export function invalidateStorefrontOnWrite(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (reply.statusCode >= 400) return;
    if (request.routeOptions.config?.storefrontUnaffected) return;

    const tenantRef = request.store?.tenantRef;
    if (!tenantRef) return;

    await invalidateTenantCache(tenantRef, STOREFRONT_CACHE_SCOPE);
  });
}

export const CACHE_TTL = {
  /** Changes rarely, read on every single page. */
  storefrontConfig: 300,
  navigation: 300,
  categories: 300,
  brands: 300,
  homepage: 120,
  /** Listings change with stock, so they are held only briefly. */
  productList: 60,
  productDetail: 60,
  page: 300,
  /**
   * The filter panel outlives the page it was drawn beside.
   *
   * Facets are five aggregate queries over the whole matching set — the most
   * expensive thing a listing does — and they do not depend on which page is
   * being viewed or how it is sorted, so one entry serves every page of a
   * filter combination. Held longer than the listing itself because an option
   * count that trails the catalogue by two minutes is a number beside a
   * checkbox, not a price.
   */
  facets: 120,
  /** Type-ahead: fires per keystroke, and the popular terms repeat endlessly. */
  searchSuggest: 120,
  /**
   * The category tree, as the listing reads it — resolving `?category=` into a
   * subtree of ids. Read on every category page and every product page.
   */
  categoryTree: 300,
} as const;
