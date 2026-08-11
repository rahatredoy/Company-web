import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getShippingMethods, paymentMethodsFrom } from '@/lib/api/checkout';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Alert } from '@/components/ui/alert';
import { CheckoutForm } from '@/components/checkout/checkout-form';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const config = await getStoreConfig();
  const [locale, shippingMethods] = await Promise.all([
    readLocalePreference(config),
    // Quoted for the store's default country; the form re-quotes once a real
    // address is entered, which is when the rate can actually be known.
    getShippingMethods({ country: 'Bangladesh' }),
  ]);

  const paymentMethods = paymentMethodsFrom(config);

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'Cart', href: '/cart' }, { label: 'Checkout' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Checkout</h1>

      {paymentMethods.length === 0 ? (
        <Alert tone="warning" title="Checkout is unavailable" className="mt-8">
          This store has no payment methods enabled yet. Please contact us to place your order.
        </Alert>
      ) : (
        <CheckoutForm
          shippingMethods={shippingMethods}
          paymentMethods={paymentMethods}
          locale={locale.language}
        />
      )}
    </div>
  );
}
