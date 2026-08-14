import 'server-only';
import { PAGE_SIZE } from '@/config';
import type { OrderDetail, OrderSummary } from '@/types';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

/**
 * Orders.
 *
 * Every call here is **visitor-specific**, so none of it is cached and all of
 * it forwards the session cookie. A shared cache entry holding one customer's
 * order is the worst bug this codebase could have, which is why the public
 * catalogue reads and these live in separate modules with opposite defaults.
 */

export async function getOrders(query: { page?: number; status?: string } = {}): Promise<{
  items: OrderSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}> {

  const { apiFetchPaginated } = await import('./client');
  const result = await apiFetchPaginated<OrderSummary>('/api/v1/storefront/account/orders', {
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
    query: { page: query.page ?? 1, pageSize: PAGE_SIZE.orders, status: query.status },
  });

  return { items: result.data, meta: result.meta };
}

export async function getOrder(orderNumber: string): Promise<OrderDetail | null> {

  return apiFetch<OrderDetail | null>(
    `/api/v1/storefront/account/orders/${encodeURIComponent(orderNumber)}`,
    {
      ...(await storeCall()),
      cookieHeader: await cookieHeader(),
      allowNotFound: true,
    },
  );
}

/**
 * Guest order lookup.
 *
 * Requires the order number **and** the email it was placed with. Order numbers
 * are sequential-ish and printed on packaging, so one alone is not a secret and
 * must not be enough to reveal an address and a phone number.
 */
export async function trackOrder(orderNumber: string, email: string): Promise<OrderDetail | null> {

  return apiFetch<OrderDetail | null>('/api/v1/storefront/orders/track', {
    method: 'POST',
    body: { orderNumber, email },
    ...(await storeCall()),
    allowNotFound: true,
  });
}
