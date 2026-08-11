import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Package, RotateCcw, Truck } from 'lucide-react';
import { getCustomer, getAddresses, getReturns } from '@/lib/api/account';
import { getOrders } from '@/lib/api/orders';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { AddressBlock } from '@/components/account/order-detail-parts';
import { formatDate, formatMoney, pluralise } from '@/lib/utils';

export const metadata: Metadata = { title: 'My account', robots: { index: false, follow: false } };

/** Order statuses that still need watching, as opposed to finished ones. */
const ACTIVE = new Set(['pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery']);

export default async function AccountDashboard() {
  const [customer, orderPage, addresses, returns, config] = await Promise.all([
    getCustomer(),
    getOrders({ page: 1 }),
    getAddresses(),
    getReturns(),
    getStoreConfig(),
  ]);
  const locale = await readLocalePreference(config);

  const active = orderPage.items.filter((order) => ACTIVE.has(order.status));
  const completed = orderPage.items.filter((order) => order.status === 'delivered');
  const defaultAddress = addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
  const latest = orderPage.items[0];

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">
        Welcome back{customer?.fullName ? `, ${customer.fullName.split(' ')[0]}` : ''}
      </h1>
      <p className="mt-2 text-muted">Here is what is happening with your orders.</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Truck} label="Active orders" value={String(active.length)} href="/account/orders" />
        <Stat icon={Package} label="Completed" value={String(completed.length)} href="/account/orders?status=delivered" />
        <Stat icon={RotateCcw} label="Returns" value={String(returns.length)} href="/account/returns" />
        <Stat icon={MapPin} label="Addresses" value={String(addresses.length)} href="/account/addresses" />
      </ul>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Latest order</h2>
          <Link href="/account/orders" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>

        {latest ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-(--radius-card) border border-border bg-surface p-5">
            <div>
              <p className="font-mono font-semibold">{latest.orderNumber}</p>
              <p className="mt-0.5 text-sm text-muted">
                {formatDate(latest.placedAt, locale.language)} · {latest.itemCount}{' '}
                {pluralise(latest.itemCount, 'item')} ·{' '}
                {formatMoney(latest.total, latest.currency, locale.language)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={latest.status} />
              <Button asChild size="sm" variant="outline">
                <Link href={`/account/orders/${latest.orderNumber}`}>View</Link>
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No orders yet"
            description="When you place an order it will appear here."
            action={
              <Button asChild>
                <Link href="/shop">Start shopping</Link>
              </Button>
            }
            className="mt-4 rounded-(--radius-card) border border-dashed border-border"
          />
        )}
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Default address</h2>
          <Link href="/account/addresses" className="text-sm font-medium text-primary hover:underline">
            Manage
          </Link>
        </div>

        <div className="mt-4 rounded-(--radius-card) border border-border bg-surface p-5">
          <AddressBlock address={defaultAddress} />
        </div>
      </section>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Truck;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-(--radius-card) border border-border bg-surface p-4 transition-colors hover:border-primary"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-xl font-bold tabular-nums">{value}</span>
          <span className="block text-xs text-subtle">{label}</span>
        </span>
      </Link>
    </li>
  );
}
