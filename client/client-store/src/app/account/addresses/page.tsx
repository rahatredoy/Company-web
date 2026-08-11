import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { getAddresses } from '@/lib/api/account';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { AddressBlock } from '@/components/account/order-detail-parts';

export const metadata: Metadata = { title: 'Addresses', robots: { index: false, follow: false } };

/**
 * Saved delivery addresses.
 *
 * Read-only for now, and the page says so rather than showing Add and Edit
 * buttons that would fail — the Commerce API has no address write endpoint yet.
 * A disabled-looking control that does nothing is worse than an honest note.
 */
export default async function AddressesPage() {
  const addresses = await getAddresses();

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">Addresses</h1>
      <p className="mt-2 text-muted">Where we send your orders.</p>

      {addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No saved addresses"
          description="The address you enter at checkout is saved here automatically."
          className="mt-8 rounded-(--radius-card) border border-dashed border-border"
        />
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="rounded-(--radius-card) border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">{address.label ?? 'Address'}</p>
                {address.isDefault ? <Badge tone="soft">Default</Badge> : null}
              </div>
              <AddressBlock address={address} className="mt-3" />
            </li>
          ))}
        </ul>
      )}

      <Alert tone="info" className="mt-8">
        Adding and editing addresses from this page is coming. For now, the address you enter at
        checkout is the one used, and it is saved here afterwards.
      </Alert>
    </>
  );
}
