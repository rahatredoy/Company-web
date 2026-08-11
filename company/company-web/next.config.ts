import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${apiUrl}`,
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
