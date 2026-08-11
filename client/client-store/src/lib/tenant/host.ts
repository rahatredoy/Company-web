import { publicConfig } from '@/config';

/**
 * Hostname → store, and hostname → the API address that names that store.
 *
 * Deliberately free of `server-only`, unlike the rest of `lib/tenant`: the
 * browser has to answer the same question about `window.location`, and a second
 * copy of the parser is how the two quietly drift apart.
 *
 * The Commerce API re-derives everything here from its own request and does not
 * trust what this app sends, so a disagreement is a bug, not a way in.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

export function isValidStoreSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes('--');
}

/** `abc-fashion.company.com` → `abc-fashion`. Custom domains carry no slug. */
export function slugFromHost(host: string | null | undefined, rootDomain: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();

  if (hostname.endsWith(`.${rootDomain}`)) {
    const prefix = hostname.slice(0, -(rootDomain.length + 1));
    const parts = prefix.split('.');
    const candidate = parts[parts.length - 1];
    return candidate && isValidStoreSlug(candidate) ? candidate : null;
  }

  if (hostname.endsWith('.localhost')) {
    const candidate = hostname.slice(0, -'.localhost'.length).split('.')[0];
    return candidate && isValidStoreSlug(candidate) ? candidate : null;
  }

  return null;
}

/** `example.com` → `https://example.com`; loopback stays on http. */
function originFor(host: string): string {
  const hostname = host.split(':')[0]!.toLowerCase();
  const local = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
  return `${local ? 'http' : 'https'}://${host}`;
}

/**
 * Which origin an API call made from `host` must go to.
 *
 * `NEXT_PUBLIC_COMMERCE_API_URL` is a **pattern**, not a fixed address. One
 * deployment of this storefront serves every store, and the API decides which
 * store a request belongs to from the `Host` header alone — so a single shared
 * API origin would make every store's requests look identical and none of them
 * resolve.
 *
 * 1. **Development** — the API is called at its configured address and the store
 *    travels in `X-Store-Slug`, honoured only while the API's own
 *    `DEV_STORE_SLUG` is set.
 *
 * 2. **A platform address** (`abc-fashion.company.com`) — the slug is in the
 *    hostname, so it is substituted into the pattern, e.g.
 *    `https://api.abc-fashion.company.com`.
 *
 * 3. **A connected custom domain** (`mystore.com`) — no slug to substitute and
 *    no per-store API hostname to build, so the call goes to the storefront's
 *    own origin. The edge proxy in front of this deployment must route `/api/*`
 *    to the Commerce API **with the original `Host` preserved** — that hostname
 *    is what the API looks up in the platform's verified-domain table. A
 *    Next.js rewrite cannot stand in for that proxy: a rewrite replaces `Host`
 *    with the destination's, which is exactly the information being relied on.
 */
export function apiBaseForHost(host: string | null | undefined): string {
  if (publicConfig.devStoreSlug) return publicConfig.apiUrl;

  const slug = slugFromHost(host, publicConfig.platformRootDomain);
  if (slug) return publicConfig.apiUrl.replace(/\{slug\}/g, slug).replace(/\/$/, '');

  // Falling back to the raw pattern would put a `{slug}` placeholder on the
  // wire, which fails loudly rather than silently reaching the wrong store.
  return host ? originFor(host) : publicConfig.apiUrl;
}
