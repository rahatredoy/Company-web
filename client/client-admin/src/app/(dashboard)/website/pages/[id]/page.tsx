import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { PageDetail, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetOptional } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { PageEditor } from '@/components/admin/page-editor';
import { StatusBadge } from '@/components/ui/status-badge';

export const metadata: Metadata = { title: 'Page' };
export const dynamic = 'force-dynamic';

export default async function EditPagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const canManage = session.authenticated && can(session.admin, 'website.manage');

  // `/website/pages/new` is this same route with a reserved id, so the editor
  // has one implementation for creating and editing rather than two that drift.
  if (id === 'new') {
    return (
      <div className="space-y-6">
        <PageHeader title="New page" description="It stays a draft until you publish it." />
        <PageEditor page={null} canManage={canManage} />
      </div>
    );
  }

  const page = await serverGetOptional<PageDetail>(`/api/v1/admin/website/pages/${id}`);
  if (!page) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={page.title}
        description={`/page/${page.slug}`}
        actions={<StatusBadge status={page.status} />}
      />
      <PageEditor page={page} canManage={canManage} />
    </div>
  );
}
