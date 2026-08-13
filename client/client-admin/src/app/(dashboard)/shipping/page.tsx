import type { Metadata } from 'next';
import type { SessionResponse, ShippingZoneRow } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { ShippingManager } from '@/components/admin/shipping-manager';

export const metadata: Metadata = { title: 'Shipping' };
export const dynamic = 'force-dynamic';

export default async function ShippingPage() {
  const [session, zones] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<ShippingZoneRow[]>('/api/v1/admin/shipping/zones'),
  ]);

  const currency = session.authenticated ? session.store.currency : 'USD';
  const canManage = session.authenticated && can(session.admin, 'orders.update');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping"
        description="Where you deliver and what you charge. Checkout quotes from these rows and charges from them again."
      />
      <ShippingManager zones={zones} currency={currency} canManage={canManage} />
    </div>
  );
}
