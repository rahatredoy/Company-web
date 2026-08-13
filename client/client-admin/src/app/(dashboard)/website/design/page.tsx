import type { Metadata } from 'next';
import type { SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { publicEnv, storefrontUrl } from '@/lib/env';
import { PageHeader } from '@/components/admin/page-header';
import { DesignPicker, type DesignPayload } from '@/components/admin/design-picker';

export const metadata: Metadata = { title: 'Design' };
export const dynamic = 'force-dynamic';

export default async function DesignPage() {
  const [session, design] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<DesignPayload>('/api/v1/admin/website/design'),
  ]);

  const canManage = session.authenticated && can(session.admin, 'website.manage');
  const slug = session.authenticated ? session.store.slug : (publicEnv.devStoreSlug ?? '');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Design"
        description={`${design.templates.length} layouts × ${design.themes.length} colours. Pick one of each; nothing changes until you publish.`}
      />
      <DesignPicker design={design} storefrontUrl={storefrontUrl(slug)} canManage={canManage} />
    </div>
  );
}
