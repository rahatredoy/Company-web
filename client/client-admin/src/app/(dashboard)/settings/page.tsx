import type { Metadata } from 'next';
import type { PaymentMethodRow, SessionResponse, StoreSettingsRow } from '@/lib/types';
import { can } from '@/lib/types';
import { getT } from '@/lib/i18n/server';
import { serverGet } from '@/lib/server-api';
import { SettingsForm } from '@/components/admin/settings-form';
import type { DesignPayload } from '@/components/admin/design-picker';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Settings') };
}
export const dynamic = 'force-dynamic';

/**
 * Everything the owner sets up once, on one screen with one Save: the store,
 * its contact details, payment methods, and how the storefront looks.
 *
 * The design is read only when the admin may read it — the API answers 403
 * otherwise, which would take the whole screen down with it — and its sections
 * are simply not drawn without it.
 *
 * What is deliberately not here: warehouses (provisioning seeds the one default
 * a shop needs), the stock alert and the weight sizes (each product sets its
 * own), the SEO title and description, and category icons. The API keeps each
 * of those as stored when a save leaves it out.
 */
export default async function SettingsPage() {
  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const admin = session.authenticated ? session.admin : null;

  const [settings, paymentMethods, design] = await Promise.all([
    serverGet<StoreSettingsRow>('/api/v1/admin/settings'),
    serverGet<PaymentMethodRow[]>('/api/v1/admin/settings/payment-methods'),
    can(admin, 'website.view') ? serverGet<DesignPayload>('/api/v1/admin/website/design') : null,
  ]);

  return (
    <SettingsForm
      settings={settings}
      paymentMethods={paymentMethods}
      design={design}
      canUpdate={can(admin, 'settings.update')}
      canManageDesign={can(admin, 'website.manage')}
    />
  );
}
