import { slugFromHost } from './store-slug';

/**
 * Every configured address, upgraded to `https://` unless it is loopback.
 *
 * A misconfigured `NEXT_PUBLIC_*` is the one way plaintext gets back into a
 * platform that is otherwise HTTPS end to end, and it is a quiet one: an
 * `http://` API address does not fail, it just means every request this app
 * makes — session cookie included — is readable and rewritable by anyone on the
 * path. The browser would block most of them as mixed content on an https page,
 * which turns a security mistake into a baffling outage instead of a warning.
 *
 * So the scheme is not taken on trust from the environment. Loopback is the one
 * exception and has to be: the six apps talk to each other over
 * `http://localhost` on six ports in development, and there is no network
 * between them.
 *
 * Applied to **patterns** as well as fixed addresses — `http://{slug}.localhost`
 * is loopback and left alone, `http://api.{slug}.company.com` is not and is
 * upgraded.
 */
function secure(value: string): string {
  if (!value.startsWith('http://')) return value;

  const rest = value.slice('http://'.length);
  const hostname = rest.split('/')[0]!.split(':')[0]!.toLowerCase();
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0';

  return loopback ? value : `https://${rest}`;
}

/**
 * Public runtime values. Everything here is compiled into the browser bundle,
 * so nothing secret may ever be added to this file.
 */
export const publicEnv = {
  /**
   * Where the Commerce API answers — a **pattern**, not a fixed address.
   *
   * One deployment of this panel serves every store, so a single hard-coded API
   * origin cannot work: the API decides which store a request belongs to from
   * the hostname it arrives on, and a shared hostname carries no store. `{slug}`
   * is substituted from the address the visitor actually reached, e.g.
   * `https://api.{slug}.company.com`. See `apiBaseForHost`.
   */
  apiUrl: secure(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100'),
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? 'ShopSaaS',
  rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'company.com',
  /**
   * Local-only fallback. Windows and Node do not resolve `*.localhost`, so in
   * development the panel names the store in an `X-Store-Slug` header instead
   * of relying on a wildcard hostname. The API accepts that header only when
   * its own `DEV_STORE_SLUG` is set, which it forces off in production.
   */
  devStoreSlug: process.env.NEXT_PUBLIC_DEV_STORE_SLUG || undefined,
  storeUrlPattern: secure(process.env.NEXT_PUBLIC_STORE_URL_PATTERN ?? 'http://{slug}.localhost:3003'),
  /**
   * Where the owner's **SaaS account** lives — plan, billing, invoices, domains.
   *
   * None of that is this panel's to show: the control plane owns it and this app
   * holds no session for it. Anything about paying for the store therefore links
   * out rather than rendering here. Empty falls back to the root domain, which
   * is right in production and wrong in development, where the company site is
   * on a port of its own.
   */
  platformUrl: process.env.NEXT_PUBLIC_PLATFORM_URL ? secure(process.env.NEXT_PUBLIC_PLATFORM_URL) : undefined,
} as const;

export const isDevSlugMode = Boolean(publicEnv.devStoreSlug);

export function storefrontUrl(slug: string): string {
  return publicEnv.storeUrlPattern.replace(/\{slug\}/g, slug);
}

/** A page of the owner's SaaS dashboard, e.g. `platformUrl('/dashboard/plans')`. */
export function platformUrl(path = ''): string {
  const base = (publicEnv.platformUrl ?? `https://${publicEnv.rootDomain}`).replace(/\/$/, '');
  return `${base}${path}`;
}

/**
 * Which origin an API call made from `host` must go to.
 *
 * The API identifies the store by the `Host` header and nothing else, so the
 * address this panel calls has to be one that names the store — otherwise every
 * store's requests arrive looking identical and none of them resolve.
 *
 * Three cases, in order:
 *
 * 1. **Development** — the API is called at its configured address and the slug
 *    travels in `X-Store-Slug`, which the API honours only while its own
 *    `DEV_STORE_SLUG` is set. (The *browser* takes one extra detour on top of
 *    this: see `api.ts#apiBase`.)
 *
 * 2. **A platform address** (`admin.<slug>.company.com`) — the slug is in the
 *    hostname, so it is substituted into the pattern and the API is called
 *    directly at `api.<slug>.company.com`. Same site, and the session cookie is
 *    scoped to `.<slug>.company.com`, which covers both.
 *
 * 3. **A connected custom domain** (`admin.mystore.com`) — there is no slug to
 *    substitute, and no per-store API hostname to build. The call goes to the
 *    panel's own origin, and the edge proxy in front of this deployment must
 *    route `/api/*` to the Commerce API **with the original `Host` preserved**.
 *    That is what lets the API look the hostname up in the platform's
 *    verified-domain table and find the tenant. A Next.js rewrite cannot stand
 *    in for that proxy: a rewrite replaces `Host` with the destination's, which
 *    is exactly the information being relied on.
 */
export function apiBaseForHost(host: string | null | undefined): string {
  if (isDevSlugMode) return publicEnv.apiUrl;

  const slug = slugFromHost(host, publicEnv.rootDomain);
  if (slug) return publicEnv.apiUrl.replace(/\{slug\}/g, slug).replace(/\/$/, '');

  // Custom domain, or a host we cannot read: same origin, proxied at the edge.
  // Falling back to the raw pattern would send a `{slug}` placeholder over the
  // wire, which fails loudly instead of silently reaching the wrong store.
  return host ? originFor(host) : publicEnv.apiUrl;
}

/** `example.com` → `https://example.com`; loopback stays on http. */
function originFor(host: string): string {
  const hostname = host.split(':')[0]!.toLowerCase();
  const local = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
  return `${local ? 'http' : 'https'}://${host}`;
}
