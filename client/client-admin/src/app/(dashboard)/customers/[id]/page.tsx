import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CustomerDetail, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetOptional } from '@/lib/server-api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/admin/page-header';
import { CustomerActions } from '@/components/admin/customer-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export const metadata: Metadata = { title: 'Customer' };
export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customer = await serverGetOptional<CustomerDetail>(`/api/v1/admin/customers/${id}`);
  if (!customer) notFound();

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const currency = session.authenticated ? session.store.currency : 'USD';
  const canUpdate = session.authenticated && can(session.admin, 'customers.update');

  const spent = customer.orders
    .filter((order) => order.status !== 'cancelled' && order.status !== 'failed')
    .reduce((total, order) => total + Number(order.grandTotal), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.fullName}
        description={
          <span>
            {customer.email}
            {customer.phone ? ` · ${customer.phone}` : ''} · joined {formatDate(customer.createdAt)}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <StatusBadge status={customer.status} />
            <StatusBadge status={customer.customerType} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Placed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customer.orders.length === 0 ? (
                      <TableEmpty colSpan={4}>This customer has not ordered yet.</TableEmpty>
                    ) : (
                      customer.orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Link
                              href={`/orders/${order.id}`}
                              className="font-mono text-sm hover:underline"
                            >
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDateTime(order.placedAt)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={order.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(order.grandTotal, order.currency || currency)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableWrapper>
            </CardContent>
          </Card>

          {customer.addresses.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Saved addresses</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {customer.addresses.map((address, index) => (
                  <address
                    key={index}
                    className="text-sm not-italic leading-relaxed text-muted-foreground"
                  >
                    <span className="block font-medium text-foreground">{address.fullName}</span>
                    <span className="block">{address.addressLine1}</span>
                    {address.addressLine2 ? <span className="block">{address.addressLine2}</span> : null}
                    <span className="block">
                      {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
                    </span>
                    <span className="block">{address.country}</span>
                  </address>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Orders</span>
                <span className="tabular-nums">{customer.orders.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lifetime spend</span>
                <span className="font-medium tabular-nums">{formatMoney(String(spent), currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email verified</span>
                <span>{customer.emailVerified ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Marketing</span>
                <span>{customer.acceptsMarketing ? 'Opted in' : 'Opted out'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last signed in</span>
                <span>{customer.lastLoginAt ? formatDate(customer.lastLoginAt) : '—'}</span>
              </div>
            </CardContent>
          </Card>

          <CustomerActions customer={customer} canUpdate={canUpdate} />
        </div>
      </div>
    </div>
  );
}
