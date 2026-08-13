import type { Metadata } from 'next';
import type { AttributeRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { AttributeManager } from '@/components/admin/attribute-manager';

export const metadata: Metadata = { title: 'Attributes' };
export const dynamic = 'force-dynamic';

export default async function AttributesPage() {
  const [session, attributes] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<AttributeRow[]>('/api/v1/admin/attributes'),
  ]);

  const canManage = session.authenticated && can(session.admin, 'attributes.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attributes"
        description="The options your products vary by, and the filters shoppers narrow a listing with."
      />
      <AttributeManager rows={attributes} canManage={canManage} />
    </div>
  );
}
