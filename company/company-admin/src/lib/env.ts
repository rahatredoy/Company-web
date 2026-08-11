/**
 * Public runtime values. Everything here is compiled into the browser bundle,
 * so nothing secret may ever be added to this file.
 */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? 'ShopSaaS',
  websiteUrl: process.env.NEXT_PUBLIC_WEBSITE_URL ?? 'http://localhost:3000',
} as const;
