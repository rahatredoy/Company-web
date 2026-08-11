import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, RotateCcw, Truck } from 'lucide-react';
import { getOrder } from '@/lib/api/orders';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { OrderTimeline } from '@/components/account/order-timeline';
import { AddressBlock, OrderLines, OrderTotals } from '@/components/account/order-detail-parts';
import { CancelOrderDialog } from '@/components/account/cancel-order-dialog';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Order', robots: { index: false, follow: false } };

/**
 * A single order.
 *
 * Cancel and Return appear only when the **server** says they are possible
 * (`canCancel`, `canRequestReturn`). Deciding that here — "cancel if the status
 * is pending" — would put a business rule in the browser, where it drifts from
 * the one the API actually enforces and produces buttons that fail on click.
 *
 * Internal staff notes are not in `OrderDetail` at all, so this page cannot leak
 * them by accident.
 */
export default async function OrderDetailPage({
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
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/account/orders" className="text-sm text-muted hover:text-primary">
            ← All orders
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-semibold">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">
            Placed {formatDate(order.placedAt, locale.language)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusBadge status={order.status} />
          <StatusBadge status={order.paymentStatus} />
        </div>
      </div>

      {order.tracking?.number ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-border bg-surface-alt p-4">
          <Truck className="size-5 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{order.tracking.carrier ?? 'Courier'}</span>{' '}
            <span className="font-mono text-muted">{order.tracking.number}</span>
          </p>
          {order.tracking.url ? (
            <Button asChild size="sm" variant="outline">
              <a href={order.tracking.url} target="_blank" rel="noreferrer noopener">
                Track parcel
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <section className="rounded-(--radius-card) border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Items</h2>
            <OrderLines
              lines={order.lines}
              currency={order.currency}
              locale={locale.language}
              className="mt-4"
            />
            <OrderTotals
              totals={order.totals}
              locale={locale.language}
              className="mt-4 border-t border-border pt-4"
            />
          </section>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <section className="rounded-(--radius-card) border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Delivery address</h2>
              <AddressBlock address={order.shippingAddress} className="mt-3" />
            </section>

            <section className="rounded-(--radius-card) border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Payment &amp; delivery</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">Payment</dt>
                  <dd className="text-right">{order.paymentMethodLabel ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">Delivery</dt>
                  <dd className="text-right">{order.shippingMethodLabel ?? '—'}</dd>
                </div>
                {order.estimatedDeliveryAt ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-subtle">Estimated</dt>
                    <dd className="text-right">
                      {formatDate(order.estimatedDeliveryAt, locale.language)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {order.canRequestReturn ? (
              <Button asChild variant="outline">
                <Link href={`/returns/request/${order.orderNumber}`}>
                  <RotateCcw aria-hidden />
                  Request a return
                </Link>
              </Button>
            ) : null}

            {order.invoiceUrl ? (
              <Button asChild variant="outline">
                <a href={order.invoiceUrl} target="_blank" rel="noreferrer noopener">
                  <Download aria-hidden />
                  Download invoice
                </a>
              </Button>
            ) : null}

            {order.canCancel ? <CancelOrderDialog orderNumber={order.orderNumber} /> : null}
          </div>
        </div>

        <section className="rounded-(--radius-card) border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Progress</h2>
          <OrderTimeline timeline={order.timeline} locale={locale.language} className="mt-4" />
        </section>
      </div>
    </>
  );
}
