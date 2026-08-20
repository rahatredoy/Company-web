'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import type { OrderRow, OrderView } from '@/lib/types';
import {
  DetailBool,
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailJson,
  DetailProse,
  DetailSection,
  DetailSheet,
  DetailTable,
  DetailTotals,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * One order, and everything the six tables behind it hold.
 *
 * The order row itself, its lines, both addresses, the payments, the shipments,
 * the status history, and the returns and refunds raised against it. `GET
 * /orders/:id` already read all of that — it selects the whole `orders` row —
 * and the full-page screen shows most of it; what this adds is the columns
 * neither showed: the four stage timestamps, `inventory_released`, the
 * originating IP and the `metadata` blob.
 *
 * **`inventory_released` is worth its own field.** It is the difference between
 * a cancelled order whose stock is back on the shelf and one whose stock is
 * still committed to a sale that will never happen, and nothing else on the
 * screen says which.
 */
export function OrderDetail({
  row,
  open,
  onOpenChange,
}: {
  row: OrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useDetail<OrderView>({
    path: '/api/v1/admin/orders',
    id: row?.id ?? null,
    enabled: open,
  });

  const order = detail.data;
  const currency = order?.currency ?? row?.currency ?? 'USD';
  const shipping = order?.addresses.find((address) => address.type === 'shipping');
  const billing = order?.addresses.find((address) => address.type === 'billing');

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="font-mono">{order?.orderNumber ?? row?.orderNumber ?? 'Order'}</span>}
      subtitle={
        order ? `${order.customerName} · placed ${formatDateTime(order.placedAt)}` : row?.customerName
      }
      badge={
        <>
          <StatusBadge status={order?.status ?? row?.status ?? 'new'} />
          <StatusBadge status={order?.paymentStatus ?? row?.paymentStatus ?? 'pending'} />
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/orders/${row.id}`}>Open full record</Link>
          </Button>
        ) : null
      }
    >
      {order ? (
        <div className="space-y-6">
          <DetailSection title="Order">
            <DetailGrid>
              <DetailField label="Number" value={order.orderNumber} mono />
              <DetailField label="Status" value={<StatusBadge status={order.status} />} />
              <DetailField label="Payment" value={<StatusBadge status={order.paymentStatus} />} />
              <DetailField label="Shipping" value={<StatusBadge status={order.shippingStatus} />} />
              <DetailField label="Placed" value={formatDateTime(order.placedAt)} />
              <DetailField label="Confirmed" value={formatDateTime(order.confirmedAt)} />
              <DetailField label="Dispatched" value={formatDateTime(order.shippedAt)} />
              <DetailField label="Delivered" value={formatDateTime(order.deliveredAt)} />
              <DetailField label="Cancelled" value={formatDateTime(order.cancelledAt)} />
              <DetailField label="Cancel reason" value={order.cancelReason} />
              <DetailField label="Expected delivery" value={formatDateTime(order.estimatedDeliveryAt)} />
              <DetailField
                label="Stock released"
                value={<DetailBool value={order.inventoryReleased} />}
                hint="Whether the units this order reserved went back on sale."
              />
              <DetailField label="Order ID" value={<DetailId value={order.id} />} />
              <DetailField label="Placed from" value={order.ipAddress} mono />
              <DetailField label="Record created" value={formatDateTime(order.createdAt)} />
              <DetailField label="Record updated" value={formatDateTime(order.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Customer">
            <DetailGrid>
              <DetailField
                label="Name"
                value={
                  order.customer ? (
                    <Link href={`/customers/${order.customer.id}`} className="hover:underline">
                      {order.customerName}
                    </Link>
                  ) : (
                    order.customerName
                  )
                }
                hint={order.customer ? undefined : 'Guest checkout — no account.'}
              />
              <DetailField label="Email" value={order.email} />
              <DetailField label="Phone" value={order.phone} />
              <DetailField label="Account ID" value={<DetailId value={order.customerId} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Items">
            <DetailTable
              rows={order.lines}
              rowKey={(line) => line.id}
              empty="This order has no lines."
              columns={[
                {
                  key: 'product',
                  header: 'Product',
                  cell: (line) => (
                    <div className="flex items-start gap-2">
                      <LazyImage
                        src={line.imageUrl}
                        alt=""
                        className="size-9 rounded border border-border bg-muted"
                        fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                      />
                      <div className="min-w-0">
                        {line.productId ? (
                          <Link
                            href={`/products/${line.productId}`}
                            className="block truncate hover:underline"
                          >
                            {line.productName}
                          </Link>
                        ) : (
                          <span className="block truncate">{line.productName}</span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">
                          {[line.measureLabel ?? line.variantTitle, line.sku].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </div>
                    </div>
                  ),
                },
                { key: 'qty', header: 'Qty', align: 'right', cell: (line) => line.quantity },
                {
                  key: 'unit',
                  header: 'Unit',
                  align: 'right',
                  cell: (line) => formatMoney(line.unitSalePrice ?? line.unitPrice, currency),
                },
                {
                  key: 'returned',
                  header: 'Returned',
                  align: 'right',
                  cell: (line) => (line.returnedQuantity > 0 ? line.returnedQuantity : '—'),
                },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  cell: (line) => formatMoney(line.lineTotal, currency),
                },
              ]}
            />
          </DetailSection>

          <DetailSection title="Totals">
            <DetailTotals
              rows={[
                { label: 'Subtotal', value: formatMoney(order.subtotal, currency) },
                {
                  label: order.couponCode ? `Discount (${order.couponCode})` : 'Discount',
                  value: `−${formatMoney(order.discountTotal, currency)}`,
                  muted: true,
                },
                { label: 'Tax', value: formatMoney(order.taxTotal, currency) },
                {
                  label: order.shippingMethodLabel ? `Shipping (${order.shippingMethodLabel})` : 'Shipping',
                  value: formatMoney(order.shippingTotal, currency),
                },
                { label: 'Refunded', value: `−${formatMoney(order.refundedTotal, currency)}`, muted: true },
                { label: 'Grand total', value: formatMoney(order.grandTotal, currency), strong: true },
              ]}
            />
          </DetailSection>

          <DetailSection title="Addresses">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['Shipping', shipping] as const,
                ['Billing', billing] as const,
              ].map(([label, address]) => (
                <div key={label} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{label}</p>
                  {address ? (
                    <>
                      <p>{address.fullName}</p>
                      <p className="text-muted-foreground">{address.phone}</p>
                      <p className="text-muted-foreground">
                        {address.addressLine1}
                        {address.addressLine2 ? `, ${address.addressLine2}` : ''}
                        <br />
                        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
                        <br />
                        {address.country}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Not recorded.</p>
                  )}
                </div>
              ))}
            </div>
          </DetailSection>

          <DetailSection title="Payment">
            <DetailGrid className="mb-3">
              <DetailField label="Provider" value={order.paymentProvider && titleCase(order.paymentProvider)} />
              <DetailField label="Method" value={order.paymentMethodLabel} />
              <DetailField label="Coupon" value={order.couponCode} mono />
              <DetailField label="Coupon ID" value={<DetailId value={order.couponId} />} />
            </DetailGrid>

            <DetailTable
              rows={order.payments}
              rowKey={(payment) => payment.id}
              empty="No payment attempt recorded."
              columns={[
                { key: 'provider', header: 'Provider', cell: (payment) => titleCase(payment.provider) },
                { key: 'status', header: 'Status', cell: (payment) => <StatusBadge status={payment.status} /> },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  cell: (payment) => formatMoney(payment.amount, payment.currency),
                },
                {
                  key: 'refunded',
                  header: 'Refunded',
                  align: 'right',
                  cell: (payment) => formatMoney(payment.refundedAmount, payment.currency),
                },
                {
                  key: 'reference',
                  header: 'Reference',
                  cell: (payment) => (
                    <span className="font-mono text-xs break-all">{payment.providerReference ?? '—'}</span>
                  ),
                },
                { key: 'paid', header: 'Paid', cell: (payment) => formatDateTime(payment.paidAt) },
              ]}
            />
          </DetailSection>

          <DetailSection title="Shipments">
            <DetailTable
              rows={order.shipments}
              rowKey={(shipment) => shipment.id}
              empty="Nothing dispatched yet."
              columns={[
                { key: 'carrier', header: 'Carrier', cell: (shipment) => shipment.carrier ?? '—' },
                {
                  key: 'tracking',
                  header: 'Tracking',
                  cell: (shipment) =>
                    shipment.trackingUrl ? (
                      <a
                        href={shipment.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs hover:underline"
                      >
                        {shipment.trackingNumber ?? 'Track'}
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{shipment.trackingNumber ?? '—'}</span>
                    ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (shipment) => <StatusBadge status={shipment.status} />,
                },
                { key: 'sent', header: 'Dispatched', cell: (shipment) => formatDateTime(shipment.shippedAt) },
              ]}
            />
          </DetailSection>

          {order.returns.length > 0 || order.refunds.length > 0 ? (
            <DetailSection title="Returns and refunds">
              <div className="space-y-3">
                <DetailTable
                  rows={order.returns}
                  rowKey={(entry) => entry.id}
                  empty="No return requested."
                  columns={[
                    {
                      key: 'number',
                      header: 'Return',
                      cell: (entry) => (
                        <Link href={`/returns/${entry.id}`} className="font-mono text-[13px] hover:underline">
                          {entry.returnNumber}
                        </Link>
                      ),
                    },
                    { key: 'reason', header: 'Reason', cell: (entry) => titleCase(entry.reason) },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (entry) => <StatusBadge status={entry.status} />,
                    },
                    {
                      key: 'amount',
                      header: 'Refundable',
                      align: 'right',
                      cell: (entry) => formatMoney(entry.refundableAmount, currency),
                    },
                  ]}
                />

                <DetailTable
                  rows={order.refunds}
                  rowKey={(refund) => refund.id}
                  empty="No refund raised."
                  columns={[
                    {
                      key: 'number',
                      header: 'Refund',
                      cell: (refund) => <span className="font-mono text-[13px]">{refund.refundNumber}</span>,
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (refund) => <StatusBadge status={refund.status} />,
                    },
                    { key: 'method', header: 'Method', cell: (refund) => refund.method ?? '—' },
                    {
                      key: 'amount',
                      header: 'Amount',
                      align: 'right',
                      cell: (refund) => formatMoney(refund.amount, refund.currency),
                    },
                    {
                      key: 'settled',
                      header: 'Settled',
                      cell: (refund) => formatDateTime(refund.completedAt),
                    },
                  ]}
                />
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="History" description="Every move, including the ones the customer never saw.">
            <DetailTable
              rows={order.history}
              rowKey={(entry) => entry.id}
              empty="No status change recorded."
              columns={[
                {
                  key: 'change',
                  header: 'Change',
                  cell: (entry) => (
                    <span className="whitespace-nowrap">
                      {entry.fromStatus ? `${titleCase(entry.fromStatus)} → ` : ''}
                      {titleCase(entry.toStatus)}
                    </span>
                  ),
                },
                { key: 'by', header: 'By', cell: (entry) => entry.adminLabel ?? 'System' },
                {
                  key: 'note',
                  header: 'Note',
                  cell: (entry) => <span className="text-xs">{entry.note ?? '—'}</span>,
                },
                { key: 'when', header: 'When', cell: (entry) => formatDateTime(entry.createdAt) },
              ]}
            />
          </DetailSection>

          <DetailSection title="Notes">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">From the customer</p>
                {order.customerNote ? (
                  <DetailProse>{order.customerNote}</DetailProse>
                ) : (
                  <DetailEmpty>None.</DetailEmpty>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Staff note</p>
                {order.adminNote ? (
                  <DetailProse>{order.adminNote}</DetailProse>
                ) : (
                  <DetailEmpty>None.</DetailEmpty>
                )}
              </div>
            </div>
          </DetailSection>

          <DetailSection title="Metadata" description="Whatever checkout attached to this order.">
            <DetailJson value={order.metadata} />
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}
