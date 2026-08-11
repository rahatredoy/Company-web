import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOrder } from '@/lib/api/orders';
import { getCustomer } from '@/lib/api/account';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Alert } from '@/components/ui/alert';
import { ReturnWizard } from '@/components/returns/return-wizard';

export const metadata: Metadata = { title: 'Request a return', robots: { index: false, follow: false } };

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
  const locale = await readLocalePreference(config);

  return (
    <div className="container-store max-w-3xl py-6">
      <Breadcrumbs
        items={[
          { label: 'My account', href: '/account' },
          { label: order.orderNumber, href: `/account/orders/${order.orderNumber}` },
          { label: 'Request a return' },
        ]}
        className="mb-6"
      />

      <h1 className="text-2xl font-semibold sm:text-3xl">Request a return</h1>
      <p className="mt-2 text-muted">
        Order <span className="font-mono">{order.orderNumber}</span>. Thirty days from delivery,
        unworn with tags on —{' '}
        <Link href="/page/return-policy" className="font-medium text-primary hover:underline">
          the full policy
        </Link>
        .
      </p>

      {/*
        Whether a return is still possible is the server's decision, not a date
        comparison done here — the window can be extended for a specific order
        and this page would never know.
      */}
      {order.canRequestReturn ? (
        <ReturnWizard order={order} locale={locale.language} />
      ) : (
        <Alert tone="warning" title="This order cannot be returned" className="mt-8">
          {order.status === 'delivered'
            ? 'The return window for this order has closed. Contact us if something is wrong and we will still look at it.'
            : 'Returns can be started once an order has been delivered.'}
        </Alert>
      )}
    </div>
  );
}
