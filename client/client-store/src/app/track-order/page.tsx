import type { Metadata } from 'next';
import { PackageSearch } from 'lucide-react';
import { getStoreConfig } from '@/lib/api/store';
import { trackOrder } from '@/lib/api/orders';
import { readLocalePreference } from '@/lib/locale/preference';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { OrderTimeline } from '@/components/account/order-timeline';
import { OrderLines, AddressBlock } from '@/components/account/order-detail-parts';
import { getT } from '@/lib/i18n/server';
import { formatDate } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Track your order'),
    description: t('Look up an order with your order number and email address.'),
  };
}

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
  const [locale, t] = await Promise.all([readLocalePreference(config), getT()]);
  const order = submitted ? await trackOrder(orderNumber!, email!) : null;

  return (
    <div className="container-store max-w-3xl py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('Track your order')}</h1>
      <p className="mt-2 text-muted">
        {t('Enter your order number and the email address you used, and we will show you where it is.')}
      </p>

      <form method="get" className="mt-8 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field name="order" label={t('Order number')} required>
          {(props) => (
            <Input
              {...props}
              defaultValue={orderNumber ?? ''}
              placeholder="ORD-123456"
              autoComplete="off"
            />
          )}
        </Field>

        <Field name="email" label={t('Email address')} required>
          {(props) => (
            <Input
              {...props}
              type="email"
              defaultValue={email ?? ''}
              // i18n-ignore — an example address, not copy
              placeholder="you@example.com"
              autoComplete="email"
            />
          )}
        </Field>

        <Button type="submit" size="lg">
          {t('Track')}
        </Button>
      </form>

      {submitted && !order ? (
        <Alert tone="warning" title={t('We could not find that order')} className="mt-8">
          {t(
            'Check the order number and the email address you used, then try again. If you have just ordered, it can take a few minutes to appear.',
          )}
        </Alert>
      ) : null}

      {order ? (
        <div className="mt-8 rounded-(--radius-card) border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <p className="font-mono text-lg font-semibold">{order.orderNumber}</p>
              <p className="text-sm text-muted">
                {t('Placed {date}', { date: formatDate(order.placedAt, locale.language) })}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <StatusBadge status={order.status} />
              <StatusBadge status={order.paymentStatus} />
            </div>
          </div>

          <div className="grid gap-6 py-4 sm:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-semibold">{t('Progress')}</h2>
              <OrderTimeline timeline={order.timeline} locale={locale.language} />
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold">{t('Delivering to')}</h2>
              <AddressBlock address={order.shippingAddress} />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h2 className="mb-3 text-sm font-semibold">{t('Items')}</h2>
            <OrderLines lines={order.lines} currency={order.currency} locale={locale.language} />
          </div>
        </div>
      ) : null}

      {!submitted ? (
        <div className="mt-10 flex items-start gap-3 rounded-(--radius-card) bg-surface-alt p-5 text-sm text-muted">
          <PackageSearch className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p>
            {t.rich(
              'Your order number is in your confirmation email and starts with {prefix}. If you have an account, your orders are listed there without needing this page.',
              { prefix: <code>ORD-</code> },
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
