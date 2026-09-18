import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, RotateCcw } from 'lucide-react';
import { getOrder } from '@/lib/api/orders';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { OrderTimeline } from '@/components/account/order-timeline';
import { AddressBlock, OrderLines, OrderTotals } from '@/components/account/order-detail-parts';
import { CancelOrderDialog } from '@/components/account/cancel-order-dialog';
import { getT } from '@/lib/i18n/server';
import { formatDate } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Order'), robots: { index: false, follow: false } };
}

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
  const [locale, t] = await Promise.all([readLocalePreference(config), getT()]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/account/orders" className="text-sm text-muted hover:text-primary">
            {t('← All orders')}
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-semibold">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('Placed {date}', { date: formatDate(order.placedAt, locale.language) })}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusBadge status={order.status} />
          <StatusBadge status={order.paymentStatus} />
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <section className="rounded-(--radius-card) border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">{t('Items')}</h2>
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
              <h2 className="text-sm font-semibold">{t('Delivery address')}</h2>
              <AddressBlock address={order.shippingAddress} className="mt-3" />
            </section>

            <section className="rounded-(--radius-card) border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">{t('Payment')}</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">{t('Payment')}</dt>
                  <dd className="text-right">{order.paymentMethodLabel ?? '—'}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {order.canRequestReturn ? (
              <Button asChild variant="outline">
                <Link href={`/returns/request/${order.orderNumber}`}>
                  <RotateCcw aria-hidden />
                  {t('Request a return')}
                </Link>
              </Button>
            ) : null}

            {order.invoiceUrl ? (
              <Button asChild variant="outline">
                <a href={order.invoiceUrl} target="_blank" rel="noreferrer noopener">
                  <Download aria-hidden />
                  {t('Download invoice')}
                </a>
              </Button>
            ) : null}

            {order.canCancel ? <CancelOrderDialog orderNumber={order.orderNumber} /> : null}
          </div>
        </div>

        <section className="rounded-(--radius-card) border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">{t('Progress')}</h2>
          <OrderTimeline timeline={order.timeline} locale={locale.language} className="mt-4" />
        </section>
      </div>
    </>
  );
}
