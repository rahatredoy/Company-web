import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private surfaces. These pages also set `robots: noindex` themselves,
        // so a crawler that ignores this file still gets the right signal.
        disallow: ['/dashboard', '/dashboard/', '/verify-email', '/reset-password'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
