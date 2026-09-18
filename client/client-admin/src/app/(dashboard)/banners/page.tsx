import type { Metadata } from 'next';
import type { BannerRow, CategoryRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { currentStoreSlug, serverGet, serverGetAll } from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { getT } from '@/lib/i18n/server';
import { PageHeader } from '@/components/admin/page-header';
import { BannerManager } from '@/components/admin/banner-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Banners') };
}

export const dynamic = 'force-dynamic';

export default async function BannersPage() {
  const [t, session, slug, banners, categories] = await Promise.all([
    getT(),
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    // For the view panel's link out to the shop the artwork appears on.
    currentStoreSlug(),
    serverGet<BannerRow[]>('/api/v1/admin/banners'),
    /*
     * The whole tree, for the destination picker. Two levels shown as two
     * selects, so the list a banner is chosen from is the same one a product is
     * filed under — see `product-form.tsx#CategoryPicker`.
     */
    serverGetAll<CategoryRow>('/api/v1/admin/categories'),
  ]);

  const canManage = session.authenticated && can(session.admin, 'marketing.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Banners')}
        description={t(
          'The artwork across your storefront. A wide strip wants 1920 × 384 px — every shape’s size is listed when you add one.',
        )}
      />
      <BannerManager
        rows={banners}
        categories={categories}
        canManage={canManage}
        storefrontBase={slug ? storefrontUrl(slug) : null}
      />
    </div>
  );
}
