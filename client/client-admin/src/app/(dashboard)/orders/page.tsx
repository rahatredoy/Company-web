import type { Metadata } from 'next';
import {
  ORDER_DEFAULTS,
  OrderManager,
  type DatePreset,
  type OrderFilterState,
} from '@/components/admin/order-manager';
import { serverGet, serverGetListed, serverGetOptional } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { can, type OrderRow, type OrderStats, type SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

/**
 * A calendar day in the store's own timezone, as `YYYY-MM-DD`.
 *
 * The presets have to agree with the tally above the list, and that is counted in
 * `store_settings.timezone` — so "today" for a shop in Dhaka is its own day, not
 * whichever one the server happens to be having. `en-CA` is the locale that
 * formats as YYYY-MM-DD, which is what the API's date filters take.
 */
function dayIn(zone: string, offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 86_400_000);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    // An unknown timezone in the settings must not take the page down with it.
    return at.toISOString().slice(0, 10);
  }
}

/** A preset is only ever shorthand for a `from`/`to` pair the API understands. */
function rangeFor(preset: DatePreset, zone: string, custom: { from: string; to: string }) {
  switch (preset) {
    case 'today':
      return { from: dayIn(zone), to: dayIn(zone) };
    case 'week':
      return { from: dayIn(zone, -6), to: dayIn(zone) };
    case 'month':
      return { from: dayIn(zone, -29), to: dayIn(zone) };
    case 'custom':
      return custom;
    default:
      return { from: '', to: '' };
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = single(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };
  const date = (key: string) => {
    const value = single(key) ?? '';
    return DATE.test(value) ? value : '';
  };

  const [session, stats] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    // A card missing beats the whole screen failing, so the tally is optional.
    serverGetOptional<OrderStats>('/api/v1/admin/orders/stats'),
  ]);

  const admin = session.authenticated ? session.admin : null;
  const store = session.authenticated ? session.store : null;
  const zone = stats?.timezone || store?.timezone || 'UTC';

  const preset = oneOf('range', ['all', 'today', 'week', 'month', 'custom'] as const, 'all');
  const range = rangeFor(preset, zone, { from: date('from'), to: date('to') });

  const filters: OrderFilterState = {
    search: single('search') ?? '',
    status: single('status') ?? 'all',
    paymentStatus: single('payment') ?? 'all',
    needsAction: oneOf('open', ['all', 'yes'] as const, 'all'),
    preset,
    from: range.from,
    to: range.to,
    sort: oneOf('sort', ['placedAt', 'grandTotal', 'orderNumber'] as const, ORDER_DEFAULTS.sort),
    order: oneOf('order', ['asc', 'desc'] as const, ORDER_DEFAULTS.order),
  };

  /*
   * The **first batch only**, and no cursor — which is what makes the API count
   * the filtered book of orders and return `total`. Every batch after this one
   * is fetched in the browser by cursor and skips the count.
   *
   * Rendered here rather than in the browser so the first response already
   * carries rows: the reader sees the list before any JavaScript runs.
   */
  const first = await serverGetListed<OrderRow>('/api/v1/admin/orders', {
    pageSize: BATCH_SIZE,
    search: filters.search || undefined,
    status: filters.status,
    paymentStatus: filters.paymentStatus,
    needsAction: filters.needsAction,
    from: filters.from || undefined,
    to: filters.to || undefined,
    sort: filters.sort,
    order: filters.order,
  });

  return (
    <OrderManager
      initial={{ rows: first.data, meta: first.meta }}
      stats={stats}
      currency={store?.currency ?? 'USD'}
      canUpdate={can(admin, 'orders.update')}
      canCancel={can(admin, 'orders.cancel')}
      filters={filters}
    />
  );
}
