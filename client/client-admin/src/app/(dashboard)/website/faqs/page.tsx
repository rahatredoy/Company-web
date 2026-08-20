import type { Metadata } from 'next';
import type { FaqRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { FaqManager } from '@/components/admin/faq-manager';
import { PageHeader } from '@/components/admin/page-header';

export const metadata: Metadata = { title: 'FAQs' };
export const dynamic = 'force-dynamic';

export default async function FaqsPage() {
  const [session, faqs] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<FaqRow[]>('/api/v1/admin/website/faqs'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="FAQs"
        description="The questions your storefront answers before a shopper has to ask you."
      />

      <FaqManager rows={faqs} canManage={session.authenticated && can(session.admin, 'website.manage')} />
    </div>
  );
}
