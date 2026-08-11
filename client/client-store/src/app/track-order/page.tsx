import type { Metadata } from 'next';
import { PackageSearch } from 'lucide-react';
import { getStoreConfig } from '@/lib/api/store';
import { trackOrder } from '@/lib/api/orders';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { OrderTimeline } from '@/components/account/order-timeline';
import { OrderLines, AddressBlock } from '@/components/account/order-detail-parts';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Look up an order with your order number and email address.',
};

/**
 * Guest order tracking.
 *
 * A plain GET form: the lookup is in the URL, so a result can be refreshed,
 * bookmarked and shared with the person who actually placed the order. No
 * JavaScript involved.
 *
 * Requires **both** the order number and the email. Order numbers are printed
 * on packaging and are not a secret; requiring the email is what stops the page
 * being a way to read a stranger's delivery address off a discarded box.
 *
 * A wrong pair and a non-existent order produce the same message, so this
 * cannot be used to discover which order numbers exist.
 */
export default async function TrackOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; email?: string }>;
}) {
  const { order: orderNumber, email } = await searchParams;
  const submitted = Boolean(orderNumber && email);

  const config = await getStoreConfig();
  const locale = await readLocalePreference(config);
  const order = submitted ? await trackOrder(orderNumber!, email!) : null;

  return (
    <div className="container-store max-w-3xl py-6">
      <Breadcrumbs items={[{ label: 'Track your order' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Track your order</h1>
      <p className="mt-2 text-muted">
        Enter your order number and the email address you used, and we will show you where it is.
      </p>

      <form method="get" className="mt-8 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field name="order" label="Order number" required>
          {(props) => (
            <Input
              {...props}
              defaultValue={orderNumber ?? ''}
              placeholder="ORD-123456"
              autoComplete="off"
            />
          )}
        </Field>

        <Field name="email" label="Email address" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              defaultValue={email ?? ''}
              placeholder="you@example.com"
              autoComplete="email"
            />
          )}
        </Field>

        <Button type="submit" size="lg">
          Track
        </Button>
      </form>

      {submitted && !order ? (
        <Alert tone="warning" title="We could not find that order" className="mt-8">
          Check the order number and the email address you used, then try again. If you have just
          ordered, it can take a few minutes to appear.
        </Alert>
      ) : null}

      {order ? (
        <div className="mt-8 rounded-(--radius-card) border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <p className="font-mono text-lg font-semibold">{order.orderNumber}</p>
              <p className="text-sm text-muted">
                Placed {formatDate(order.placedAt, locale.language)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <StatusBadge status={order.status} />
              <StatusBadge status={order.paymentStatus} />
            </div>
          </div>

          {order.tracking?.number ? (
            <dl className="grid gap-4 border-b border-border py-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-subtle">Courier</dt>
                <dd className="mt-0.5 font-medium">{order.tracking.carrier ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-subtle">Tracking number</dt>
                <dd className="mt-0.5 font-mono font-medium">
                  {order.tracking.url ? (
                    <a
                      href={order.tracking.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline"
                    >
                      {order.tracking.number}
                    </a>
                  ) : (
                    order.tracking.number
                  )}
                </dd>
              </div>
            </dl>
          ) : null}

          <div className="grid gap-6 py-4 sm:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-semibold">Progress</h2>
              <OrderTimeline timeline={order.timeline} locale={locale.language} />
              {order.estimatedDeliveryAt ? (
                <p className="mt-4 text-sm text-muted">
                  Estimated delivery {formatDate(order.estimatedDeliveryAt, locale.language)}
                </p>
              ) : null}
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold">Delivering to</h2>
              <AddressBlock address={order.shippingAddress} />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h2 className="mb-3 text-sm font-semibold">Items</h2>
            <OrderLines lines={order.lines} currency={order.currency} locale={locale.language} />
          </div>
        </div>
      ) : null}

      {!submitted ? (
        <div className="mt-10 flex items-start gap-3 rounded-(--radius-card) bg-surface-alt p-5 text-sm text-muted">
          <PackageSearch className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p>
            Your order number is in your confirmation email and starts with <code>ORD-</code>. If
            you have an account, your orders are listed there without needing this page.
          </p>
        </div>
      ) : null}
    </div>
  );
}
