import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStoreConfig } from '@/lib/api/store';
import { getAddresses, getCustomer } from '@/lib/api/account';
import { paymentMethodsFrom } from '@/lib/api/checkout';
import { readLocalePreference } from '@/lib/locale/preference';
import { Alert } from '@/components/ui/alert';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import type { Address } from '@/types';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

/**
 * Checkout is for signed-in customers only.
 *
 * Guarded here the way `/account` is — a real session lookup rather than "a
 * cookie of some name exists" — and `POST /checkout` on the Commerce API
 * refuses a signed-out basket regardless, so nothing rests on this redirect.
 * What it buys is the difference between a shopper being sent to sign in with
 * their basket intact and one filling in nine address fields before being told.
 *
 * `?next=/checkout` brings them straight back, and the basket survives because
 * it lives in `localStorage` rather than on the server.
 */
export default async function CheckoutPage() {
  const customer = await getCustomer();
  if (!customer) redirect('/login?next=/checkout');

  const config = await getStoreConfig();
  const [locale, addresses] = await Promise.all([
    readLocalePreference(config),
    // Saved details are the point of making people sign in, so the form opens
    // filled in. A failure here costs the prefill and not the checkout.
    getAddresses().catch((): Address[] => []),
  ]);

  const paymentMethods = paymentMethodsFrom(config);
  const savedAddress = addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;

  return (
    <div className="container-store py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">Checkout</h1>

      {paymentMethods.length === 0 ? (
        <Alert tone="warning" title="Checkout is unavailable" className="mt-8">
          This store has no payment methods enabled yet. Please contact us to place your order.
        </Alert>
      ) : (
        <CheckoutForm
          paymentMethods={paymentMethods}
          locale={locale.language}
          customer={customer}
          savedAddress={savedAddress}
        />
      )}
    </div>
  );
}
