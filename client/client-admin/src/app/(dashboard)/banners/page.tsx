import type { Metadata } from 'next';
import type { BannerRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { BannerManager } from '@/components/admin/banner-manager';

export const metadata: Metadata = { title: 'Banners' };
export const dynamic = 'force-dynamic';

export default async function BannersPage() {
  const [session, banners] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<BannerRow[]>('/api/v1/admin/banners'),
  ]);

  const canManage = session.authenticated && can(session.admin, 'marketing.manage');

  return (
    <div className="space-y-6">
      <PageHeader title="Banners" description="The artwork across your storefront." />
      <BannerManager rows={banners} canManage={canManage} />
    </div>
  );
}
