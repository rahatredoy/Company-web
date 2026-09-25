import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const isProduction = process.env.NODE_ENV === 'production';

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
  isProduction
    ? `script-src 'self' 'unsafe-inline' ${CLOUDFLARE_INSIGHTS_SCRIPT}`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CLOUDFLARE_INSIGHTS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${CLOUDFLARE_INSIGHTS_BEACON} ${apiUrl}`,
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
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
