import type { Metadata } from 'next';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { getOrders } from '@/lib/api/orders';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, formatMoney, pluralise } from '@/lib/utils';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'My orders', robots: { index: false, follow: false } };

/**
 * Order history.
 *
 * The status filter is a set of links, not a client-side dropdown — the filter
 * ends up in the URL, so it can be bookmarked, shared with support, and
 * survives a refresh.
 */
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Active' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'returned', label: 'Returned' },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status = 'all', page } = await searchParams;
  const config = await getStoreConfig();

  const [orders, locale] = await Promise.all([
    getOrders({ status, page: Number.parseInt(page ?? '1', 10) || 1 }),
    readLocalePreference(config),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">My orders</h1>

      <nav aria-label="Filter orders" className="mt-6">
        <ul className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border">
          {FILTERS.map((filter) => {
            const active = status === filter.value;
            return (
              <li key={filter.value}>
                <Link
                  href={filter.value === 'all' ? '/account/orders' : `/account/orders?status=${filter.value}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px block whitespace-nowrap border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition-colors',
                    active
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-foreground',
                  )}
                >
                  {filter.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {orders.items.length === 0 ? (
        <EmptyState
          icon={Package}
          title={status === 'all' ? 'You have not placed any orders yet' : 'Nothing here'}
          description={
            status === 'all'
              ? 'Once you order something it will show up here with its tracking.'
              : 'No orders match this filter.'
          }
          action={
            <Button asChild>
              <Link href={status === 'all' ? '/shop' : '/account/orders'}>
                {status === 'all' ? 'Start shopping' : 'Show all orders'}
              </Link>
            </Button>
          }
          className="mt-8 rounded-(--radius-card) border border-dashed border-border"
        />
      ) : (
        <ul className="mt-6 space-y-4">
          {orders.items.map((order) => (
            <li
              key={order.orderNumber}
              className="rounded-(--radius-card) border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono font-semibold">{order.orderNumber}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    Placed {formatDate(order.placedAt, locale.language)} · {order.itemCount}{' '}
                    {pluralise(order.itemCount, 'item')}
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {formatMoney(order.total, order.currency, locale.language)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <StatusBadge status={order.status} />
                    <StatusBadge status={order.paymentStatus} />
                  </div>

                  <Button asChild size="sm" variant="outline">
                    <Link href={`/account/orders/${order.orderNumber}`}>View order</Link>
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {orders.meta.totalPages > 1 ? (
        <nav aria-label="Pagination" className="mt-8 flex justify-center gap-2">
          {Array.from({ length: orders.meta.totalPages }, (_, index) => index + 1).map((number) => (
            <Link
              key={number}
              href={`/account/orders?${new URLSearchParams({ ...(status !== 'all' ? { status } : {}), page: String(number) })}`}
              aria-current={number === orders.meta.page ? 'page' : undefined}
              className={cn(
                'grid size-9 place-items-center rounded-(--radius-button) text-sm font-medium',
                number === orders.meta.page
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border hover:bg-surface-alt',
              )}
            >
              {number}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
