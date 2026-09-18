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
import { getT } from '@/lib/i18n/server';
import { formatDate, formatMoney } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('My account'), robots: { index: false, follow: false } };
}

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
  const [locale, t] = await Promise.all([readLocalePreference(config), getT()]);

  const active = orderPage.items.filter((order) => ACTIVE.has(order.status));
  const completed = orderPage.items.filter((order) => order.status === 'delivered');
  const defaultAddress = addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
  const latest = orderPage.items[0];

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">
        {customer?.fullName
          ? t('Welcome back, {name}', { name: customer.fullName.split(' ')[0] ?? '' })
          : t('Welcome back')}
      </h1>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Truck} label={t('Active orders')} value={t.number(active.length)} href="/account/orders" />
        <Stat icon={Package} label={t('Completed')} value={t.number(completed.length)} href="/account/orders?status=delivered" />
        <Stat icon={RotateCcw} label={t('Returns')} value={t.number(returns.length)} href="/account/returns" />
        <Stat icon={MapPin} label={t('Addresses')} value={t.number(addresses.length)} href="/account/addresses" />
      </ul>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('Latest order')}</h2>
          <Link href="/account/orders" className="text-sm font-medium text-primary hover:underline">
            {t('View all')}
          </Link>
        </div>

        {latest ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-(--radius-card) border border-border bg-surface p-5">
            <div>
              <p className="font-mono font-semibold">{latest.orderNumber}</p>
              <p className="mt-0.5 text-sm text-muted">
                {t.plural(latest.itemCount, '{date} · {count} item · {total}', '{date} · {count} items · {total}', {
                  date: formatDate(latest.placedAt, locale.language),
                  total: formatMoney(latest.total, latest.currency, locale.language),
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={latest.status} />
              <Button asChild size="sm" variant="outline">
                <Link href={`/account/orders/${latest.orderNumber}`}>{t('View')}</Link>
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            title={t('No orders yet')}
            description={t('When you place an order it will appear here.')}
            action={
              <Button asChild>
                <Link href="/shop">{t('Start shopping')}</Link>
              </Button>
            }
            className="mt-4 rounded-(--radius-card) border border-dashed border-border"
          />
        )}
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('Default address')}</h2>
          <Link href="/account/addresses" className="text-sm font-medium text-primary hover:underline">
            {t('Manage')}
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
