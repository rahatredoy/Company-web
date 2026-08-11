import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

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
 * The admin panel is the highest-value surface on the platform, so it ships a
 * tighter policy than the public site: no indexing, no framing, no third-party
 * connections at all.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${connectSource(apiUrl)}`.trimEnd(),
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
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
