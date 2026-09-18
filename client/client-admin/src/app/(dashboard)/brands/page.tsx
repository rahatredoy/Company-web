import type { Metadata } from 'next';
import { BrandManager, type BrandFilterState } from '@/components/admin/brand-manager';
import { currentStoreSlug, serverGet, serverGetAll } from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { can, type BrandRow, type SessionResponse } from '@/lib/types';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Brands') };
}

export const dynamic = 'force-dynamic';

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = single(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };

  const [session, slug, rows] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    currentStoreSlug(),
    /*
     * Every brand, not a batch of them. The screen counts, filters and orders in
     * the browser, and a drag reorder renumbers the real list rather than the
     * rows that happen to be on screen — all of which needs the whole set.
     * Brands are flat and few, so this is one small read.
     */
    serverGetAll<BrandRow>('/api/v1/admin/brands'),
  ]);

  const initial: BrandFilterState = {
    search: single('search') ?? '',
    status: oneOf('status', ['all', 'active', 'inactive'] as const, 'all'),
    featured: oneOf('featured', ['all', 'yes', 'no'] as const, 'all'),
    usage: oneOf('usage', ['all', 'used', 'unused'] as const, 'all'),
  };

  /*
   * "This month" is settled on the server so the count in the stat card is the
   * same on both renders — deriving it in the browser would let a page rendered
   * just before midnight hydrate into a different number.
   */
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  return (
    <BrandManager
      rows={rows}
      canManage={session.authenticated && can(session.admin, 'brands.manage')}
      storefrontBase={slug ? storefrontUrl(slug) : null}
      monthStart={monthStart}
      initial={initial}
    />
  );
}
