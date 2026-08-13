import type { Metadata } from 'next';
import { getAddresses } from '@/lib/api/account';
import { AddressBook } from '@/components/account/address-book';

export const metadata: Metadata = { title: 'Addresses', robots: { index: false, follow: false } };

/**
 * Saved delivery addresses.
 *
 * The list is read on the server and handed down as plain data; every write goes
 * back through `/api/account/addresses`, which holds the `httpOnly` session the
 * browser cannot read for itself.
 */
export default async function AddressesPage() {
  const addresses = await getAddresses();

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">Addresses</h1>
      <p className="mt-2 text-muted">Where we send your orders.</p>

      <AddressBook addresses={addresses} />
    </>
  );
}
