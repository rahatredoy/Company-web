import type { Metadata } from 'next';
import type { PaymentMethodRow, SessionResponse, StoreSettingsRow } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { SettingsForm } from '@/components/admin/settings-form';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [session, settings, paymentMethods] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<StoreSettingsRow>('/api/v1/admin/settings'),
    serverGet<PaymentMethodRow[]>('/api/v1/admin/settings/payment-methods'),
  ]);

  const canUpdate = session.authenticated && can(session.admin, 'settings.update');

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={`Your store at ${settings.slug}.`} />
      <SettingsForm settings={settings} paymentMethods={paymentMethods} canUpdate={canUpdate} />
    </div>
  );
}
