'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import type { RefundRow, RefundView } from '@/lib/types';
import {
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

/**
 * Money going back out, and the three records that decide whether it should.
 *
 * The refund row says what was asked for. The order says what was taken and how
 * much of it has already gone back — which is the cap this refund is checked
 * against on completion, and the reason `remainingOnOrder` is computed by the
 * API rather than left as a subtraction for the reader. The payments say *how*
 * the money arrived, which is what a reversal has to follow.
 *
 * Nothing here talks to a gateway. This platform settles `cod` and `mock`, so a
 * refund is a physical act somebody performs and then records — `method`,
 * `providerReference` and `completedAt` are that record.
 */
export function RefundDetail({
  row,
  open,
  onOpenChange,
}: {
  row: RefundRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useDetail<RefundView>({
    path: '/api/v1/admin/refunds',
    id: row?.id ?? null,
    enabled: open,
  });

  const refund = detail.data;
  const currency = refund?.currency ?? row?.currency ?? 'USD';

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="font-mono">{refund?.refundNumber ?? row?.refundNumber ?? 'Refund'}</span>}
      subtitle={
        refund ? `${formatMoney(refund.amount, currency)} · ${refund.order.customerName}` : row?.customerName
      }
      badge={<StatusBadge status={refund?.status ?? row?.status ?? 'requested'} />}
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        refund ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/orders/${refund.orderId}`}>Open the order</Link>
          </Button>
        ) : null
      }
    >
      {refund ? (
        <div className="space-y-6">
          <DetailSection title="Refund">
            <DetailGrid>
              <DetailField label="Number" value={refund.refundNumber} mono />
              <DetailField label="Status" value={<StatusBadge status={refund.status} />} />
              <DetailField label="Amount" value={formatMoney(refund.amount, currency)} />
              <DetailField
                label="How it went back"
                value={refund.method ? titleCase(refund.method) : null}
                hint={refund.method ? undefined : 'Not recorded yet.'}
              />
              <DetailField label="Raised" value={formatDateTime(refund.createdAt)} />
              <DetailField label="Approved" value={formatDateTime(refund.approvedAt)} />
              <DetailField label="Settled" value={formatDateTime(refund.completedAt)} />
              <DetailField label="Record updated" value={formatDateTime(refund.updatedAt)} />
              <DetailField label="Approved by" value={<DetailId value={refund.approvedBy} />} />
              <DetailField label="Gateway reference" value={refund.providerReference} mono />
              <DetailField label="Refund ID" value={<DetailId value={refund.id} />} />
              <DetailField label="Payment ID" value={<DetailId value={refund.paymentId} />} />
              <DetailField
                label="Can become"
                value={
                  refund.allowedTransitions.length ? (
                    <span className="flex flex-wrap gap-1">
                      {refund.allowedTransitions.map((next) => (
                        <StatusBadge key={next} status={next} />
                      ))}
                    </span>
                  ) : (
                    'Nothing — this is final.'
                  )
                }
                full
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Why">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Reason</p>
                {refund.reason ? <DetailProse>{refund.reason}</DetailProse> : <DetailEmpty>None given.</DetailEmpty>}
              </div>
              {refund.failureReason ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Why it failed or was rejected</p>
                  <DetailProse>{refund.failureReason}</DetailProse>
                </div>
              ) : null}
            </div>
          </DetailSection>

          <DetailSection title="Against the order">
            <DetailGrid className="mb-3">
              <DetailField
                label="Order"
                value={
                  <Link href={`/orders/${refund.orderId}`} className="font-mono text-[13px] hover:underline">
                    {refund.order.orderNumber}
                  </Link>
                }
              />
              <DetailField label="Order status" value={<StatusBadge status={refund.order.status} />} />
              <DetailField label="Payment status" value={<StatusBadge status={refund.order.paymentStatus} />} />
              <DetailField label="Placed" value={formatDateTime(refund.order.placedAt)} />
              <DetailField
                label="Paid by"
                value={
                  [refund.order.paymentProvider && titleCase(refund.order.paymentProvider), refund.order.paymentMethodLabel]
                    .filter(Boolean)
                    .join(' · ') || null
                }
              />
              <DetailField
                label="Customer"
                value={
                  refund.customerId ? (
                    <Link href={`/customers/${refund.customerId}`} className="hover:underline">
                      {refund.order.customerName}
                    </Link>
                  ) : (
                    refund.order.customerName
                  )
                }
              />
              <DetailField label="Email" value={refund.customerEmail ?? refund.order.customerEmail} />
              <DetailField label="Phone" value={refund.order.customerPhone} />
            </DetailGrid>

            <DetailTotals
              rows={[
                { label: 'Order total', value: formatMoney(refund.order.grandTotal, currency) },
                {
                  label: 'Already refunded',
                  value: `−${formatMoney(refund.order.refundedTotal, currency)}`,
                  muted: true,
                },
                {
                  label: 'Still refundable',
                  value: formatMoney(refund.remainingOnOrder, currency),
                  strong: true,
                },
              ]}
            />
          </DetailSection>

          {refund.returnId ? (
            <DetailSection title="Raised by a return">
              <DetailGrid>
                <DetailField
                  label="Return"
                  value={
                    <Link
                      href={`/returns/${refund.returnId}`}
                      className="font-mono text-[13px] hover:underline"
                    >
                      {refund.returnNumber ?? 'Open return'}
                    </Link>
                  }
                />
                <DetailField
                  label="Return status"
                  value={refund.returnStatus ? <StatusBadge status={refund.returnStatus} /> : null}
                />
              </DetailGrid>
            </DetailSection>
          ) : null}

          <DetailSection
            title="Payments on the order"
            description="What was taken, and how much of each has already been sent back."
          >
            <DetailTable
              rows={refund.payments}
              rowKey={(payment) => payment.id}
              empty="No payment recorded — cash on delivery leaves none until it is collected."
              columns={[
                { key: 'provider', header: 'Provider', cell: (payment) => titleCase(payment.provider) },
                { key: 'status', header: 'Status', cell: (payment) => <StatusBadge status={payment.status} /> },
                {
                  key: 'amount',
                  header: 'Taken',
                  align: 'right',
                  cell: (payment) => formatMoney(payment.amount, payment.currency),
                },
                {
                  key: 'refunded',
                  header: 'Sent back',
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

          <DetailSection title="Metadata">
            <DetailJson value={refund.metadata} />
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}
