import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { OrderAddressRow, OrderDetailRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetOptional } from '@/lib/server-api';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import { PageHeader } from '@/components/admin/page-header';
import { OrderNote } from '@/components/admin/order-note';
import { OrderWorkflow } from '@/components/admin/order-workflow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';

function AddressCard({ address }: { address: OrderAddressRow | undefined }) {
  if (!address) return <p className="text-sm text-muted-foreground">None recorded.</p>;

  return (
    <address className="text-sm not-italic leading-relaxed text-muted-foreground">
      <span className="block font-medium text-foreground">{address.fullName}</span>
      <span className="block">{address.addressLine1}</span>
      {address.addressLine2 ? <span className="block">{address.addressLine2}</span> : null}
      <span className="block">
        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
      </span>
      <span className="block">{address.country}</span>
      <span className="mt-1 block">{address.phone}</span>
    </address>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const order = await serverGetOptional<OrderDetailRow>(`/api/v1/admin/orders/${id}`);
  if (!order) notFound();

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const canUpdate = session.authenticated && can(session.admin, 'orders.update');
  const currency = order.currency || (session.authenticated ? session.store.currency : 'USD');

  const money = (value: string | null | undefined) => formatMoney(value ?? '0', currency);

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.orderNumber}
        description={
          <span>
            {formatDateTime(order.placedAt)} · {order.customerName} ·{' '}
            {order.customer ? (
              <Link href={`/customers/${order.customer.id}`} className="hover:underline">
                {order.email}
              </Link>
            ) : (
              <>{order.email} (guest)</>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.paymentStatus} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <span className="block font-medium">{line.productName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[line.measureLabel ?? line.variantTitle, line.sku].filter(Boolean).join(' · ') || '—'}
                            {line.returnedQuantity > 0
                              ? ` · ${line.returnedQuantity} returned`
                              : ''}
                          </span>
                        </TableCell>
                        {/*
                          What to weigh out, not just how many. A line reading
                          "2" against a product sold by the kilo is the one
                          number that gets a parcel packed wrong.

                          Printed as "x 500gm" rather than as a total, because
                          the size is a frozen label and the line does not carry
                          the base unit it was measured in — multiplying it into
                          "1kg" here would mean guessing at a unit the receipt
                          never recorded.
                        */}
                        <TableCell className="text-right tabular-nums">
                          {line.quantity}
                          {line.measureLabel ? (
                            <span className="block text-xs text-muted-foreground">
                              &times; {line.measureLabel}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(line.unitSalePrice ?? line.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(line.lineTotal)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>

              <dl className="mt-4 space-y-1.5 border-t pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{money(order.subtotal)}</dd>
                </div>
                {Number(order.discountTotal) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Discount{order.couponCode ? ` (${order.couponCode})` : ''}
                    </dt>
                    <dd className="tabular-nums text-success">−{money(order.discountTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Delivery{order.shippingMethodLabel ? ` (${order.shippingMethodLabel})` : ''}
                  </dt>
                  <dd className="tabular-nums">{money(order.shippingTotal)}</dd>
                </div>
                {Number(order.refundedTotal) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Refunded</dt>
                    <dd className="tabular-nums">−{money(order.refundedTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{money(order.grandTotal)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                {order.history.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span className="w-40 shrink-0 text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <span>
                      <span className="font-medium">{titleCase(entry.toStatus)}</span>
                      {entry.note ? <span className="text-muted-foreground"> · {entry.note}</span> : null}
                      {entry.adminLabel ? (
                        <span className="block text-xs text-muted-foreground">by {entry.adminLabel}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <OrderWorkflow order={order} canUpdate={canUpdate} />

          <Card>
            <CardHeader>
              <CardTitle>Delivery address</CardTitle>
            </CardHeader>
            <CardContent>
              <AddressCard address={order.addresses.find((a) => a.type === 'shipping')} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{order.paymentMethodLabel ?? order.paymentProvider ?? 'Not recorded'}</p>
              <p className="text-muted-foreground">{titleCase(order.paymentStatus)}</p>
            </CardContent>
          </Card>

          {order.customerNote ? (
            <Card>
              <CardHeader>
                <CardTitle>Customer note</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{order.customerNote}</p>
              </CardContent>
            </Card>
          ) : null}

          <OrderNote orderId={order.id} note={order.adminNote} canUpdate={canUpdate} />
        </div>
      </div>
    </div>
  );
}
