import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { PageDetail, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetOptional } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { PageEditor } from '@/components/admin/page-editor';
import { StatusBadge } from '@/components/ui/status-badge';
import type { MessageKey } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Page') };
}

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<PageDetail['status'], MessageKey> = {
  draft: 'Draft',
  published: 'Published',
};

export default async function EditPagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const canManage = session.authenticated && can(session.admin, 'website.manage');

  // `/website/pages/new` is this same route with a reserved id, so the editor
  // has one implementation for creating and editing rather than two that drift.
  if (id === 'new') {
    return (
      <div className="space-y-6">
        <PageHeader title={t('New page')} description={t('It stays a draft until you publish it.')} />
        <PageEditor page={null} canManage={canManage} />
      </div>
    );
  }

  const page = await serverGetOptional<PageDetail>(`/api/v1/admin/website/pages/${id}`);
  if (!page) notFound();

  // The storefront address, which reads the same in every language.
  const address = `/page/${page.slug}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={page.title}
        description={address}
        actions={<StatusBadge status={page.status} label={t(STATUS_LABELS[page.status])} />}
      />
      <PageEditor page={page} canManage={canManage} />
    </div>
  );
}
