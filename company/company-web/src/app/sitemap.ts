import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

/** Public pages only — the account area and onboarding are noindex by design. */
const ROUTES = [
  { path: '', priority: 1, changeFrequency: 'weekly' as const },
  { path: '/features', priority: 0.9, changeFrequency: 'monthly' as const },
  { path: '/templates', priority: 0.8, changeFrequency: 'monthly' as const },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' as const },
  { path: '/how-it-works', priority: 0.8, changeFrequency: 'monthly' as const },
  { path: '/security', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/faq', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/contact', priority: 0.6, changeFrequency: 'yearly' as const },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/refund', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/register', priority: 0.8, changeFrequency: 'yearly' as const },
  { path: '/sign-in', priority: 0.4, changeFrequency: 'yearly' as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicEnv.siteUrl.replace(/\/$/, '');
  const lastModified = new Date();

  return ROUTES.map((route) => ({
    url: `${base}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
