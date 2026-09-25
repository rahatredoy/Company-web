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
 * Security headers. The CSP intentionally allows only this origin plus the
 * company API — no third-party script hosts, no inline event handlers.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Next injects a small inline runtime; 'unsafe-inline' stays out of script-src
  // in production because Next emits nonces for its own inline chunks.
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
  /**
   * The signed-in area moved from /account to /dashboard. These keep old
   * bookmarks, emailed links and any external references working.
   */
  async redirects() {
    return [
      { source: '/account', destination: '/dashboard', permanent: true },
      { source: '/account/subscription', destination: '/dashboard/plans', permanent: true },
      { source: '/account/profile', destination: '/dashboard/settings', permanent: true },
      { source: '/account/:path*', destination: '/dashboard/:path*', permanent: true },
      { source: '/onboarding', destination: '/dashboard/plans', permanent: true },
      { source: '/dashboard/onboarding', destination: '/dashboard/plans', permanent: true },
      // Website setup, admin panel setup and domains are steps on the store page
      // now rather than pages of their own.
      { source: '/dashboard/website', destination: '/dashboard/store', permanent: true },
      { source: '/dashboard/admin-panel', destination: '/dashboard/store', permanent: true },
      { source: '/dashboard/domains', destination: '/dashboard/store', permanent: true },
      { source: '/login', destination: '/sign-in', permanent: false },
      { source: '/signup', destination: '/register', permanent: false },
    ];
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
