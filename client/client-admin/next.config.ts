import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * `connect-src` for an API address that is different for every store.
 *
 * `NEXT_PUBLIC_API_URL` is a pattern — `https://api.{slug}.company.com` — and a
 * literal `{slug}` in a CSP would match nothing, blocking every request the
 * panel makes. CSP host sources allow a wildcard only as the *leftmost* label,
 * so `https://api.*.company.com` is not a legal source either; the substituted
 * label and everything left of it collapse into one `*`.
 *
 * The result is broader than the single host a given store actually calls, which
 * is the price of one build serving every store. It stays inside the platform's
 * own domain, and it is a defence-in-depth control: what the API will answer is
 * decided by its own CORS check, per store and per surface.
 */
function connectSource(pattern: string): string {
  if (!pattern.includes('{slug}')) return pattern;

  try {
    const url = new URL(pattern.replace(/\{slug\}/g, '*'));
    const labels = url.hostname.split('.');
    const wildcardAt = labels.findIndex((label) => label.includes('*'));
    const host = wildcardAt < 0 ? url.hostname : ['*', ...labels.slice(wildcardAt + 1)].join('.');
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
  } catch {
    // A malformed pattern is a config error. Emitting nothing leaves `'self'`,
    // which is the right answer for a same-origin/proxied deployment anyway.
    return '';
  }
}

/**
 * Development only, and gated on the same flag as the `X-Store-Slug` escape
 * hatch so it can never be on in production.
 *
 * Locally the panel is served from `<slug>.localhost:3002` and the API from
 * `localhost:4100`. Those are different registrable domains, so the browser
 * treats the API as third party and discards its `SameSite=Lax` session
 * cookie — sign-in appears to succeed and the visitor stays signed out.
 * Proxying `/api/*` through the panel's own origin makes the cookie
 * first-party. In production the two already share the store's domain and
 * `lib/api.ts` calls the API directly, so no proxy is registered.
 */
const devStoreSlug = process.env.NEXT_PUBLIC_DEV_STORE_SLUG || undefined;

/**
 * Cloudflare Web Analytics. The proxy in front of every app injects its beacon
 * script into each page, and the CSP would otherwise block it on every load.
 * The script comes from one host and reports to another, so both are named.
 */
const CLOUDFLARE_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CLOUDFLARE_INSIGHTS_BEACON = 'https://cloudflareinsights.com';

/**
 * The admin panel is the highest-value surface on the platform, so it ships a
 * tighter policy than the public site: no indexing, no framing, no third-party
 * connections beyond Cloudflare's analytics beacon.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  /*
   * Product pictures live on the store's own R2 public domain — a different
   * hostname for every deployment, and one this app is never told: it holds no
   * storage config, and `NEXT_PUBLIC_API_URL` names the API, not the bucket. The
   * product form also accepts any `https` URL an owner pastes, so even a fixed
   * bucket host would not cover what the panel is asked to display.
   *
   * `'self' data: blob:` alone therefore blocked **every** thumbnail in the
   * panel — products, inventory, dashboard — which is why those lists rendered
   * as rows of placeholder icons. Images are not executable; the exposure here
   * is that a pasted URL can tell its host an admin loaded the page, which the
   * owner chose by pasting it. Scripts, styles, frames and connections stay
   * locked down, and `connect-src` is still the store's own API only.
   */
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  isProduction
    ? `script-src 'self' 'unsafe-inline' ${CLOUDFLARE_INSIGHTS_SCRIPT}`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CLOUDFLARE_INSIGHTS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${CLOUDFLARE_INSIGHTS_BEACON} ${connectSource(apiUrl)}`.trimEnd(),
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async rewrites() {
    if (!devStoreSlug) return [];
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  /**
   * A product is added in a panel beside the list now, not on a page of its own.
   * `?new=1` is what opens that panel, so the retired route still lands on the
   * form rather than on a 404 — which is what a bookmark, a browser suggestion
   * or a link in somebody's notes would otherwise hit.
   */
  async redirects() {
    return [
      { source: '/products/new', destination: '/products?new=1', permanent: true },
      // The Inventory screen is gone: stock is read and adjusted on each product.
      { source: '/inventory', destination: '/products', permanent: false },
      // Shipping is gone too: checkout charges from the zone the store was set up with.
      { source: '/shipping', destination: '/orders', permanent: false },
      // Design is part of the Settings screen now, not a destination of its own.
      { source: '/website/design', destination: '/settings', permanent: false },
      // Refunds are a tab of the Returns screen now.
      { source: '/refunds', destination: '/returns?tab=refunds', permanent: false },
      // Reviews are moderated on each product's Reviews tab now.
      { source: '/reviews', destination: '/products?reviews=pending', permanent: false },
      // An order has no screen of its own: it opens in the list's View panel.
      { source: '/orders/:id', destination: '/orders?view=:id', permanent: false },
      // Nor does a return or a customer: each opens in its list's View panel.
      { source: '/returns/:id', destination: '/returns?view=:id', permanent: false },
      { source: '/customers/:id', destination: '/customers?view=:id', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          /*
           * Two years, every subdomain, preload-eligible.
           *
           * **Production only.** The header is ignored by browsers when it
           * arrives over plain http, so sending it in development achieves
           * nothing — but a developer who puts `next dev` behind an https tunnel
           * on localhost would have `includeSubDomains` applied to `localhost`
           * itself, and every other app on a localhost port would stop being
           * reachable over http until the pin expired. There is no way to clear
           * that but to wait or to wipe the browser's HSTS store.
           */
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
