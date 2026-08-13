import type { Metadata } from 'next';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import type { OrderRow, SessionResponse } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All orders' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'packed', label: 'Packed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'returned', label: 'Returned' },
];

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

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const currency = session.authenticated ? session.store.currency : 'USD';

  const { data, meta } = await serverGetPaginated<OrderRow>('/api/v1/admin/orders', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
    sort: single('sort'),
    order: single('order'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Everything customers have bought, newest first."
      />

      <TableFilters searchPlaceholder="Order number, name or email" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={ShoppingCart}
          title="No orders yet"
          description="When someone buys something from your store, it will appear here."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={7}>No order matches those filters.</TableEmpty>
                ) : (
                  data.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link
                          href={`/orders/${order.id}`}
                          className="font-mono text-sm font-medium hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="block font-medium">{order.customerName}</span>
                        <span className="block text-xs text-muted-foreground">{order.email}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(order.placedAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(order.grandTotal, order.currency || currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
          <Pagination {...meta} />
        </>
      )}
    </div>
  );
}
