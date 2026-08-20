import type { Metadata } from 'next';
import type { HomepageSectionRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { HomepageBuilder } from '@/components/admin/homepage-builder';
import { PageHeader } from '@/components/admin/page-header';

export const metadata: Metadata = { title: 'Homepage' };
export const dynamic = 'force-dynamic';

export default async function HomepagePage() {
  const [session, sections] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<HomepageSectionRow[]>('/api/v1/admin/website/homepage'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Homepage"
        description="The blocks your storefront’s front page is built from, top to bottom."
      />

      <HomepageBuilder
        rows={sections}
        canManage={session.authenticated && can(session.admin, 'website.manage')}
      />
    </div>
  );
}
