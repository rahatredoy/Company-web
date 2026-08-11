import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { getStoreConfig } from '@/lib/api/store';
import { getOrder } from '@/lib/api/orders';
import { readLocalePreference } from '@/lib/locale/preference';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { OrderTimeline } from '@/components/account/order-timeline';
import { OrderLines, OrderTotals, AddressBlock } from '@/components/account/order-detail-parts';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
};

/**
 * Order confirmation.
 *
 * Reads the order back from the server rather than rendering whatever the
 * checkout form had in memory. The point of this page is to show what was
 * actually recorded — including any price the server corrected — and echoing
 * the browser's own numbers would defeat that entirely.
 */
export default async function CheckoutSuccessPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const order = await getOrder(orderNumber);
  if (!order) notFound();

  const config = await getStoreConfig();
  const locale = await readLocalePreference(config);

  return (
    <div className="container-store max-w-3xl py-10">
      <div className="text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-success/12 text-success">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>

        <h1 className="text-2xl font-semibold sm:text-3xl">Order confirmed</h1>
        <p className="mt-2 text-muted">
          Thank you. We have emailed a confirmation to{' '}
          <span className="font-medium text-foreground">{order.email}</span>.
        </p>
      </div>

      <div className="mt-8 rounded-(--radius-card) border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-subtle">Order number</p>
            <p className="font-mono text-lg font-semibold">{order.orderNumber}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.paymentStatus} />
          </div>
        </div>

        <dl className="grid gap-4 border-b border-border py-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-subtle">Placed</dt>
            <dd className="mt-0.5 font-medium">{formatDate(order.placedAt, locale.language)}</dd>
          </div>
          <div>
            <dt className="text-subtle">Payment</dt>
            <dd className="mt-0.5 font-medium">{order.paymentMethodLabel ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-subtle">Delivery</dt>
            <dd className="mt-0.5 font-medium">
              {order.estimatedDeliveryAt
                ? `Estimated ${formatDate(order.estimatedDeliveryAt, locale.language)}`
                : (order.shippingMethodLabel ?? '—')}
            </dd>
          </div>
        </dl>

        <OrderLines lines={order.lines} currency={order.currency} locale={locale.language} className="py-4" />
        <OrderTotals totals={order.totals} locale={locale.language} className="border-t border-border pt-4" />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-(--radius-card) border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Delivery address</h2>
          <AddressBlock address={order.shippingAddress} className="mt-3" />
        </div>

        <div className="rounded-(--radius-card) border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">What happens next</h2>
          <OrderTimeline timeline={order.timeline} locale={locale.language} className="mt-4" />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href={`/account/orders/${order.orderNumber}`}>View order</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/shop">Continue shopping</Link>
        </Button>
      </div>
    </div>
  );
}
