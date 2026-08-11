/**
 * Public runtime values. Everything here is compiled into the browser bundle,
 * so nothing secret may ever be added to this file.
 */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? 'ShopSaaS',
  rootDomain: process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN ?? 'company.com',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@company.com',
  adminUrl: process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001',
  /** Canonical origin of this site — used for sitemap, robots and OG metadata. */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
} as const;
