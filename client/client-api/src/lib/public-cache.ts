import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * How long a *shared* cache — a CDN, a reverse proxy — may serve one public
 * storefront read, and how long the visitor's own browser may.
 *
 * Redis in front of PostgreSQL saves the database; this saves the API process
 * entirely, which is the only thing that scales past the point where every
 * shopper's page view is a request that reaches Node at all. A catalogue read is
 * identical for every visitor of a store, so the copy the edge already holds is
 * the correct answer for the next million of them.
 *
 * Three numbers rather than one, because they answer different questions:
 *
 * - `browser` is what the visitor's own cache may reuse without asking. Kept at
 *   or near zero for anything carrying a price or a stock badge — a shopper who
 *   presses back onto a stale product page and adds to cart is a support ticket,
 *   and a browser copy is the one copy nothing can purge.
 * - `shared` is what a CDN may serve. Longer, because the edge revalidates on our
 *   schedule and an admin write drops the Redis key underneath it anyway.
 * - `stale` is `stale-while-revalidate`: the edge keeps answering from the old
 *   copy while it fetches a new one in the background, so a TTL expiring under
 *   load is a background refresh rather than a thundering herd onto the origin.
 *
 * `stale-if-error` is set to the same window: if this API is down, an old
 * catalogue page is a better answer than a 502.
 */
interface CachePolicy {
  browser: number;
  shared: number;
  stale: number;
}

/**
 * The public catalogue, and nothing else.
 *
 * Keyed by Fastify's own route pattern (`request.routeOptions.url`), which is
 * the registered path including the `/api/v1/storefront` prefix — not the URL
 * the caller typed, which they choose. An unlisted route stays `no-store`, so a
 * route added tomorrow is private until somebody deliberately lists it here.
 *
 * Every entry below is a read whose response depends on the store and the query
 * string alone. Anything that reads a cookie — the account half, checkout,
 * order tracking — is absent on purpose and must stay absent: a shared cache
 * entry for a response that varies per visitor is how one customer is served
 * another customer's page.
 */
const PUBLIC_READS: Record<string, CachePolicy> = {
  // Design, navigation, policies. Changes when the owner saves the panel.
  '/api/v1/storefront/config': { browser: 60, shared: 300, stale: 600 },
  '/api/v1/storefront/categories': { browser: 60, shared: 300, stale: 600 },
  '/api/v1/storefront/categories/:slug': { browser: 60, shared: 300, stale: 600 },
  '/api/v1/storefront/brands': { browser: 60, shared: 300, stale: 600 },
  '/api/v1/storefront/brands/:slug': { browser: 60, shared: 300, stale: 600 },
  '/api/v1/storefront/pages/:slug': { browser: 60, shared: 300, stale: 600 },
  '/api/v1/storefront/faqs': { browser: 60, shared: 300, stale: 600 },

  // The homepage layout. Moves with a campaign, so shorter.
  '/api/v1/storefront/home': { browser: 30, shared: 120, stale: 600 },

  /*
   * Which products head each aisle of the "shop by category" block. Ids only —
   * no price and no stock badge, so a browser copy is safe for a minute — but it
   * does say what is published, and the prices beside them are fetched through
   * `/products` under its own much shorter policy.
   */
  '/api/v1/storefront/categories/showcase': { browser: 30, shared: 120, stale: 600 },

  /*
   * Anything carrying a price or a stock badge. `browser: 0` means the visitor's
   * own cache always revalidates — which, with an ETag on the response, costs
   * one 304 and no body at all. The edge still absorbs the load.
   *
   * A stale listing is safe *because* nothing downstream trusts it: checkout
   * recomputes every price from the tenant database and moves stock with a
   * single conditional UPDATE, so a product that sold out inside the window
   * fails as INSUFFICIENT_STOCK at the till rather than overselling.
   */
  '/api/v1/storefront/products': { browser: 0, shared: 60, stale: 120 },
  '/api/v1/storefront/products/:slug': { browser: 0, shared: 60, stale: 120 },
  '/api/v1/storefront/products/:id/related': { browser: 0, shared: 300, stale: 600 },
  '/api/v1/storefront/products/:id/bundle': { browser: 0, shared: 300, stale: 600 },
  '/api/v1/storefront/products/:slug/reviews': { browser: 30, shared: 120, stale: 600 },

  // Type-ahead. Fires per keystroke across every shopper, so the edge is where
  // it wants to be answered.
  '/api/v1/storefront/search/suggest': { browser: 30, shared: 120, stale: 300 },
};

const CACHEABLE_METHODS = new Set(['GET', 'HEAD']);

function headerValue(policy: CachePolicy): string {
  return [
    'public',
    `max-age=${policy.browser}`,
    `s-maxage=${policy.shared}`,
    `stale-while-revalidate=${policy.stale}`,
    `stale-if-error=${policy.stale}`,
  ].join(', ');
}

/**
 * Marks the public catalogue reads cacheable by browsers and CDNs.
 *
 * Registered once on the storefront scope rather than called from each handler,
 * for the reason `invalidateStorefrontOnWrite` exists: a rule that says
 * "remember to set the header" holds until somebody adds a route, and the
 * failure — a private response in a shared cache — is the worst one this file
 * could allow. Here the default is `no-store` (set by `plugins/security.ts`) and
 * a route has to be named above to escape it.
 *
 * Four conditions have to hold, and each closes a real hole:
 *
 * 1. **The route is listed.** Nothing else is ever public.
 * 2. **The reply sets no cookie.** A `Set-Cookie` in a shared cache entry hands
 *    the next visitor somebody else's session. This is the backstop for a listed
 *    route that starts issuing one.
 * 3. **The status is 200.** A cached 404 outlives the product that was
 *    published a second later.
 * 4. **The store was named by the hostname.** `X-Store-Slug` is the development
 *    escape hatch for `*.localhost`, and a cache keyed on the URL alone cannot
 *    tell two stores apart when the store is named in a header.
 */
export function publicReadCache(app: FastifyInstance): void {
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    if (!CACHEABLE_METHODS.has(request.method)) return payload;
    if (reply.statusCode !== 200) return payload;
    if (reply.hasHeader('set-cookie')) return payload;
    if (request.headers['x-store-slug']) return payload;

    const policy = PUBLIC_READS[request.routeOptions?.url ?? ''];
    if (!policy) return payload;

    reply.header('Cache-Control', headerValue(policy));

    /*
     * No `Vary` is set here. `@fastify/compress` already sets
     * `Vary: accept-encoding` on everything it inspects, and adding a second
     * one produced a duplicated header. Nothing else needs varying on: these
     * responses depend on the hostname and the query string, both of which a
     * cache keys on already, and varying on `Origin` would hand every referring
     * origin its own edge entry for identical bytes.
     */
    return payload;
  });
}

/**
 * A stable cache key for one shape of query.
 *
 * Listings are keyed on their *parsed* filters rather than the raw query string,
 * so `?brand=a&brand=b` and `?brand=b,a` — the same listing, written two ways —
 * are one entry instead of two. Hashed rather than serialised because a facet
 * combination spells out to hundreds of bytes and Redis keys are compared in
 * full on every lookup.
 */
export function queryKey(value: unknown): string {
  return createHash('sha1').update(stableJson(value)).digest('base64url').slice(0, 22);
}

/** JSON with object keys and array members ordered, so equal inputs hash equal. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  if (Array.isArray(value)) {
    // Filter values are sets — ticking Blue then Red is the same listing as
    // ticking Red then Blue, and must not be a second cache entry.
    return `[${[...value].map(stableJson).sort().join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}
