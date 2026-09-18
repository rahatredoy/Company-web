import type { Metadata } from 'next';
import type { FaqRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { FaqManager } from '@/components/admin/faq-manager';
import { PageHeader } from '@/components/admin/page-header';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('FAQs') };
}

export const dynamic = 'force-dynamic';

export default async function FaqsPage() {
  const t = await getT();
  const [session, faqs] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<FaqRow[]>('/api/v1/admin/website/faqs'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('FAQs')}
        description={t('The questions your storefront answers before a shopper has to ask you.')}
      />

      <FaqManager rows={faqs} canManage={session.authenticated && can(session.admin, 'website.manage')} />
    </div>
  );
}
