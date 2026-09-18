import type { Metadata } from 'next';
import { getAddresses } from '@/lib/api/account';
import { AddressBook } from '@/components/account/address-book';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Addresses'), robots: { index: false, follow: false } };
}

/**
 * Saved delivery addresses.
 *
 * The list is read on the server and handed down as plain data; every write goes
 * back through `/api/account/addresses`, which holds the `httpOnly` session the
 * browser cannot read for itself.
 */
export default async function AddressesPage() {
  const [addresses, t] = await Promise.all([getAddresses(), getT()]);

  return (
    <>
      <h1 className="sr-only">{t('Addresses')}</h1>

      <AddressBook addresses={addresses} />
    </>
  );
}
