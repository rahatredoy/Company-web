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
} as const;
