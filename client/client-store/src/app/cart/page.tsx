import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { CartView } from '@/components/cart/cart-view';

export const metadata: Metadata = {
  title: 'Your cart',
  // A basket is per visitor and changes constantly; there is nothing here for
  // a crawler and plenty that should not end up in an index.
  robots: { index: false, follow: true },
};

export default async function CartPage() {
  const config = await getStoreConfig();
  const locale = await readLocalePreference(config);

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'Cart' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Your cart</h1>

      {/*
        The basket lives in the browser, so the page shell is server-rendered
        and only the contents are a client island. That keeps the header, the
        heading and the footer in the first paint.
      */}
      <CartView locale={locale.language} />
    </div>
  );
}
