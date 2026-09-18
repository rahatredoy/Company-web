'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { titleCase } from '@/lib/format';
import { useT } from '@/lib/i18n';
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
  const t = useT();
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
      title={<span className="font-mono">{refund?.refundNumber ?? row?.refundNumber ?? t('Refund')}</span>}
      subtitle={
        refund ? `${t.money(refund.amount, currency)} · ${refund.order.customerName}` : row?.customerName
      }
      badge={<StatusBadge status={refund?.status ?? row?.status ?? 'requested'} />}
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        refund ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/orders?view=${refund.orderId}`}>{t('Open the order')}</Link>
          </Button>
        ) : null
      }
    >
      {refund ? (
        <div className="space-y-6">
          <DetailSection title={t('Refund')}>
            <DetailGrid>
              <DetailField label={t('Number')} value={refund.refundNumber} mono />
              <DetailField label={t('Status')} value={<StatusBadge status={refund.status} />} />
              <DetailField label={t('Amount')} value={t.money(refund.amount, currency)} />
              <DetailField
                label={t('How it went back')}
                value={refund.method ? t.loose(titleCase(refund.method)) : null}
                hint={refund.method ? undefined : t('Not recorded yet.')}
              />
              <DetailField label={t('Raised')} value={t.dateTime(refund.createdAt)} />
              <DetailField label={t('Approved')} value={t.dateTime(refund.approvedAt)} />
              <DetailField label={t('Settled')} value={t.dateTime(refund.completedAt)} />
              <DetailField label={t('Record updated')} value={t.dateTime(refund.updatedAt)} />
              <DetailField label={t('Approved by')} value={<DetailId value={refund.approvedBy} />} />
              <DetailField label={t('Gateway reference')} value={refund.providerReference} mono />
              <DetailField label={t('Refund ID')} value={<DetailId value={refund.id} />} />
              <DetailField label={t('Payment ID')} value={<DetailId value={refund.paymentId} />} />
              <DetailField
                label={t('Can become')}
                value={
                  refund.allowedTransitions.length ? (
                    <span className="flex flex-wrap gap-1">
                      {refund.allowedTransitions.map((next) => (
                        <StatusBadge key={next} status={next} />
                      ))}
                    </span>
                  ) : (
                    t('Nothing — this is final.')
                  )
                }
                full
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t('Why')}>
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('Reason')}</p>
                {refund.reason ? <DetailProse>{refund.reason}</DetailProse> : <DetailEmpty>{t('None given.')}</DetailEmpty>}
              </div>
              {refund.failureReason ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t('Why it failed or was rejected')}</p>
                  <DetailProse>{refund.failureReason}</DetailProse>
                </div>
              ) : null}
            </div>
          </DetailSection>

          <DetailSection title={t('Against the order')}>
            <DetailGrid className="mb-3">
              <DetailField
                label={t('Order')}
                value={
                  <Link href={`/orders?view=${refund.orderId}`} className="font-mono text-[12px] hover:underline">
                    {refund.order.orderNumber}
                  </Link>
                }
              />
              <DetailField label={t('Order status')} value={<StatusBadge status={refund.order.status} />} />
              <DetailField label={t('Payment status')} value={<StatusBadge status={refund.order.paymentStatus} />} />
              <DetailField label={t('Placed')} value={t.dateTime(refund.order.placedAt)} />
              <DetailField
                label={t('Paid by')}
                value={
                  [
                    refund.order.paymentProvider && t.loose(titleCase(refund.order.paymentProvider)),
                    refund.order.paymentMethodLabel,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                }
              />
              <DetailField
                label={t('Customer')}
                value={
                  refund.customerId ? (
                    <Link href={`/customers?view=${refund.customerId}`} className="hover:underline">
                      {refund.order.customerName}
                    </Link>
                  ) : (
                    refund.order.customerName
                  )
                }
              />
              <DetailField label={t('Email')} value={refund.customerEmail ?? refund.order.customerEmail} />
              <DetailField label={t('Phone')} value={refund.order.customerPhone} />
            </DetailGrid>

            <DetailTotals
              rows={[
                { label: t('Order total'), value: t.money(refund.order.grandTotal, currency) },
                {
                  label: t('Already refunded'),
                  value: `−${t.money(refund.order.refundedTotal, currency)}`,
                  muted: true,
                },
                {
                  label: t('Still refundable'),
                  value: t.money(refund.remainingOnOrder, currency),
                  strong: true,
                },
              ]}
            />
          </DetailSection>

          {refund.returnId ? (
            <DetailSection title={t('Raised by a return')}>
              <DetailGrid>
                <DetailField
                  label={t('Return')}
                  value={
                    <Link
                      href={`/returns?view=${refund.returnId}`}
                      className="font-mono text-[12px] hover:underline"
                    >
                      {refund.returnNumber ?? t('Open return')}
                    </Link>
                  }
                />
                <DetailField
                  label={t('Return status')}
                  value={refund.returnStatus ? <StatusBadge status={refund.returnStatus} /> : null}
                />
              </DetailGrid>
            </DetailSection>
          ) : null}

          <DetailSection
            title={t('Payments on the order')}
            description={t('What was taken, and how much of each has already been sent back.')}
          >
            <DetailTable
              rows={refund.payments}
              rowKey={(payment) => payment.id}
              empty={t('No payment recorded — cash on delivery leaves none until it is collected.')}
              columns={[
                { key: 'provider', header: t('Provider'), cell: (payment) => t.loose(titleCase(payment.provider)) },
                { key: 'status', header: t('Status'), cell: (payment) => <StatusBadge status={payment.status} /> },
                {
                  key: 'amount',
                  header: t('Taken'),
                  align: 'right',
                  cell: (payment) => t.money(payment.amount, payment.currency),
                },
                {
                  key: 'refunded',
                  header: t('Sent back'),
                  align: 'right',
                  cell: (payment) => t.money(payment.refundedAmount, payment.currency),
                },
                {
                  key: 'reference',
                  header: t('Reference'),
                  cell: (payment) => (
                    <span className="font-mono text-xs break-all">{payment.providerReference ?? '—'}</span>
                  ),
                },
                { key: 'paid', header: t('Paid'), cell: (payment) => t.dateTime(payment.paidAt) },
              ]}
            />
          </DetailSection>

          <DetailSection title={t('Metadata')}>
            <DetailJson value={refund.metadata} />
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}
