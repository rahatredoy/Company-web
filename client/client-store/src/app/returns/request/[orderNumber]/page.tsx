import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOrder } from '@/lib/api/orders';
import { getCustomer } from '@/lib/api/account';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { Alert } from '@/components/ui/alert';
import { ReturnWizard } from '@/components/returns/return-wizard';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Request a return'), robots: { index: false, follow: false } };
}

export default async function ReturnRequestPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;

  const customer = await getCustomer();
  if (!customer) redirect(`/login?next=/returns/request/${orderNumber}`);

  const order = await getOrder(orderNumber);
  if (!order) notFound();

  const config = await getStoreConfig();
  const [locale, t] = await Promise.all([readLocalePreference(config), getT()]);

  return (
    <div className="container-store max-w-3xl py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('Request a return')}</h1>
      <p className="mt-2 text-muted">
        {t.rich('Order {orderNumber}. Thirty days from delivery, unworn with tags on — {policyLink}.', {
          orderNumber: <span className="font-mono">{order.orderNumber}</span>,
          policyLink: (
            <Link href="/page/return-policy" className="font-medium text-primary hover:underline">
              {t('the full policy')}
            </Link>
          ),
        })}
      </p>

      {/*
        Whether a return is still possible is the server's decision, not a date
        comparison done here — the window can be extended for a specific order
        and this page would never know.
      */}
      {order.canRequestReturn ? (
        <ReturnWizard order={order} locale={locale.language} />
      ) : (
        <Alert tone="warning" title={t('This order cannot be returned')} className="mt-8">
          {order.status === 'delivered'
            ? t('The return window for this order has closed. Contact us if something is wrong and we will still look at it.')
            : t('Returns can be started once an order has been delivered.')}
        </Alert>
      )}
    </div>
  );
}
