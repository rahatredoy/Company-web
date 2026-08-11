import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_COMMERCE_API_URL ?? 'http://localhost:4100';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * `connect-src` for an API address that is different for every store.
 *
 * `NEXT_PUBLIC_COMMERCE_API_URL` is a pattern — `https://api.{slug}.company.com`
 * — and a literal `{slug}` in a CSP would match nothing, blocking every request
 * the storefront makes. CSP host sources allow a wildcard only as the *leftmost*
 * label, so `https://api.*.company.com` is not a legal source either; the
 * substituted label and everything left of it collapse into one `*`.
 *
 * Broader than the single host a given store calls, which is the price of one
 * build serving every store. What the API will actually answer is decided by its
 * own CORS check, per store and per surface.
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
    // A malformed pattern is a config error; `'self'` is left standing, which is
    // the right answer for a same-origin/proxied deployment anyway.
    return '';
  }
}

/**
 * Unlike the admin panels, this app is meant to be indexed and shared, so the
 * policy is public-facing rather than locked down. It still refuses framing and
 * inline scripts from anywhere but ourselves — product descriptions and CMS
 * pages are authored by store owners, and a CSP is the last line of defence if
 * sanitisation is ever bypassed.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Product media comes from R2/S3 behind a CDN, so remote images are expected.
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  isProduction ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${connectSource(apiUrl)}`.trimEnd(),
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  images: {
    // Store media lives on object storage; sizes are tuned for the product
    // grids rather than left at Next's defaults.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    deviceSizes: [360, 480, 640, 828, 1080, 1280, 1600, 1920],
    imageSizes: [64, 96, 128, 200, 256, 384],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          ...(isProduction
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
        ],
      },
      {
        /*
         * Never indexed, never cached, whatever the store's robots policy says.
         *
         * The list covers every route that is either visitor-specific or a
         * near-duplicate: a wishlist and a comparison are as personal as a cart,
         * and search results generate unbounded URLs that dilute a catalogue's
         * own pages. `robots.ts` disallows the same set — that stops crawling,
         * this stops indexing of anything reached by a link from elsewhere.
         */
        source:
          '/(account|cart|checkout|wishlist|compare|track-order|login|register|forgot-password|reset-password|verify-email|search)/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // The bare paths as well as their subtrees — `/cart` does not match the
        // pattern above, only `/cart/anything` does.
        source:
          '/(account|cart|checkout|wishlist|compare|track-order|login|register|forgot-password|reset-password|verify-email|search)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },

  async redirects() {
    return [
      /*
       * Policy pages are CMS content and live under `/page/<slug>`, but they are
       * linked from invoices, emails and other shops' habits at their bare
       * paths. These keep those links working rather than 404ing.
       */
      { source: '/privacy', destination: '/page/privacy', permanent: true },
      { source: '/terms', destination: '/page/terms', permanent: true },
      { source: '/return-policy', destination: '/page/return-policy', permanent: true },
      { source: '/refund-policy', destination: '/page/refund-policy', permanent: true },
      { source: '/shipping-policy', destination: '/page/shipping-policy', permanent: true },

      // The design spec's §60 uses `/order/success/*`; its own page map in §139
      // uses `/checkout/success/*`. The page map wins and this covers the other.
      {
        source: '/order/success/:orderNumber',
        destination: '/checkout/success/:orderNumber',
        permanent: true,
      },
      { source: '/order-track', destination: '/track-order', permanent: true },
    ];
  },
};

export default nextConfig;
