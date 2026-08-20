'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import type { ReturnRow, ReturnView } from '@/lib/types';
import {
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
  DetailTable,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/** Bytes as the reader thinks of them, for an attachment's size column. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One return request, with the evidence and the paper trail.
 *
 * A return is decided on three things the list cannot show: what the customer
 * said, what they photographed, and what the inspection found line by line. The
 * last of those is the one that moves stock — only a line marked `good` goes
 * back on sale — so `inspectionResult` and `restockedQuantity` are shown per
 * line rather than summarised, and the difference between what was requested and
 * what was restocked is left visible instead of averaged away.
 *
 * The refunds are here because the return row never says whether the money
 * actually went back: completing a return *raises* a refund, and settling it is
 * a separate permission and a separate act.
 */
export function ReturnDetail({
  row,
  open,
  onOpenChange,
}: {
  row: ReturnRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useDetail<ReturnView>({
    path: '/api/v1/admin/returns',
    id: row?.id ?? null,
    enabled: open,
  });

  const entry = detail.data;
  const currency = entry?.currency ?? row?.currency ?? 'USD';

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="font-mono">{entry?.returnNumber ?? row?.returnNumber ?? 'Return'}</span>}
      subtitle={entry ? `${entry.customerName} · ${titleCase(entry.reason)}` : row?.customerName}
      badge={
        <>
          <StatusBadge status={entry?.status ?? row?.status ?? 'requested'} />
          {entry ? <StatusBadge status={entry.resolution} /> : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/returns/${row.id}`}>Open full record</Link>
          </Button>
        ) : null
      }
    >
      {entry ? (
        <div className="space-y-6">
          <DetailSection title="Request">
            <DetailGrid>
              <DetailField label="Number" value={entry.returnNumber} mono />
              <DetailField label="Status" value={<StatusBadge status={entry.status} />} />
              <DetailField label="Asked for" value={titleCase(entry.resolution)} />
              <DetailField label="Reason" value={titleCase(entry.reason)} />
              <DetailField
                label="Refundable"
                value={formatMoney(entry.refundableAmount, currency)}
                hint="Computed by the server from the accepted lines."
              />
              <DetailField label="Requested" value={formatDateTime(entry.createdAt)} />
              <DetailField label="Reviewed" value={formatDateTime(entry.reviewedAt)} />
              <DetailField label="Received back" value={formatDateTime(entry.receivedAt)} />
              <DetailField label="Completed" value={formatDateTime(entry.completedAt)} />
              <DetailField label="Record updated" value={formatDateTime(entry.updatedAt)} />
              <DetailField label="Return ID" value={<DetailId value={entry.id} />} />
              <DetailField label="Reviewed by" value={<DetailId value={entry.reviewedBy} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="What the customer said">
            {entry.description ? (
              <DetailProse>{entry.description}</DetailProse>
            ) : (
              <DetailEmpty>Nothing beyond the reason.</DetailEmpty>
            )}
          </DetailSection>

          <DetailSection title="Order and customer">
            <DetailGrid>
              <DetailField
                label="Order"
                value={
                  <Link href={`/orders/${entry.orderId}`} className="font-mono text-[13px] hover:underline">
                    {entry.orderNumber}
                  </Link>
                }
              />
              <DetailField label="Order status" value={<StatusBadge status={entry.orderStatus} />} />
              <DetailField label="Order placed" value={formatDateTime(entry.orderPlacedAt)} />
              <DetailField label="Order total" value={formatMoney(entry.orderTotal, currency)} />
              <DetailField
                label="Already refunded on it"
                value={formatMoney(entry.orderRefundedTotal, currency)}
              />
              <DetailField
                label="Customer"
                value={
                  entry.customerId ? (
                    <Link href={`/customers/${entry.customerId}`} className="hover:underline">
                      {entry.customerName}
                    </Link>
                  ) : (
                    entry.customerName
                  )
                }
                hint={entry.customerId ? undefined : 'Guest checkout — no account.'}
              />
              <DetailField label="Email" value={entry.email} />
              <DetailField label="Phone" value={entry.phone} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Lines"
            description="Only a line inspected as good goes back on sale; the rest is recorded as damaged."
          >
            <DetailTable
              rows={entry.items}
              rowKey={(item) => item.id}
              empty="No line on this return."
              columns={[
                {
                  key: 'product',
                  header: 'Product',
                  cell: (item) => (
                    <div className="flex items-start gap-2">
                      <LazyImage
                        src={item.imageUrl}
                        alt=""
                        className="size-9 rounded border border-border bg-muted"
                        fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                      />
                      <div className="min-w-0">
                        {item.productId ? (
                          <Link
                            href={`/products/${item.productId}`}
                            className="block truncate hover:underline"
                          >
                            {item.productName}
                          </Link>
                        ) : (
                          <span className="block truncate">{item.productName}</span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">
                          {[item.variantTitle, item.sku].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'qty',
                  header: 'Returning',
                  align: 'right',
                  cell: (item) => `${item.quantity} of ${item.orderedQuantity}`,
                },
                {
                  key: 'inspection',
                  header: 'Inspection',
                  cell: (item) =>
                    item.inspectionResult ? (
                      <span className="space-y-1">
                        <StatusBadge status={item.inspectionResult} />
                        {item.inspectionNote ? (
                          <span className="block text-xs text-muted-foreground">{item.inspectionNote}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not inspected</span>
                    ),
                },
                {
                  key: 'restocked',
                  header: 'Restocked',
                  align: 'right',
                  cell: (item) => formatNumber(item.restockedQuantity),
                },
                {
                  key: 'total',
                  header: 'Value',
                  align: 'right',
                  cell: (item) => formatMoney(item.lineTotal, currency),
                },
              ]}
            />
          </DetailSection>

          <DetailSection title="Evidence" description="What the customer uploaded with the request.">
            {entry.attachments.length === 0 ? (
              <DetailEmpty>Nothing attached.</DetailEmpty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {entry.attachments.map((file) => (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="space-y-1"
                    title={`${file.mimeType} · ${formatBytes(file.sizeBytes)}`}
                  >
                    <LazyImage
                      src={file.mimeType.startsWith('image/') ? file.url : null}
                      alt=""
                      className="size-24 rounded-lg border border-border bg-muted"
                      fallback={<span className="text-[10px] text-muted-foreground">File</span>}
                    />
                    <span className="block text-center text-[11px] text-muted-foreground">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Refunds raised" description="Completing a return raises one; settling it is a separate act.">
            <DetailTable
              rows={entry.refunds}
              rowKey={(refund) => refund.id}
              empty="No refund raised yet."
              columns={[
                {
                  key: 'number',
                  header: 'Refund',
                  cell: (refund) => <span className="font-mono text-[13px]">{refund.refundNumber}</span>,
                },
                { key: 'status', header: 'Status', cell: (refund) => <StatusBadge status={refund.status} /> },
                { key: 'method', header: 'Method', cell: (refund) => refund.method ?? '—' },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  cell: (refund) => formatMoney(refund.amount, refund.currency),
                },
                { key: 'settled', header: 'Settled', cell: (refund) => formatDateTime(refund.completedAt) },
              ]}
            />
          </DetailSection>

          <DetailSection title="History">
            <DetailTable
              rows={entry.history}
              rowKey={(item) => item.id}
              empty="No move recorded."
              columns={[
                {
                  key: 'change',
                  header: 'Change',
                  cell: (item) => (
                    <span className="whitespace-nowrap">
                      {item.fromStatus ? `${titleCase(item.fromStatus)} → ` : ''}
                      {titleCase(item.toStatus)}
                    </span>
                  ),
                },
                { key: 'by', header: 'By', cell: (item) => item.adminLabel ?? 'System' },
                { key: 'note', header: 'Note', cell: (item) => <span className="text-xs">{item.note ?? '—'}</span> },
                { key: 'when', header: 'When', cell: (item) => formatDateTime(item.createdAt) },
              ]}
            />
          </DetailSection>

          <DetailSection title="Decision notes">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Rejection reason</p>
                {entry.rejectionReason ? (
                  <DetailProse>{entry.rejectionReason}</DetailProse>
                ) : (
                  <DetailEmpty>Not rejected.</DetailEmpty>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Staff note</p>
                {entry.adminNote ? (
                  <DetailProse>{entry.adminNote}</DetailProse>
                ) : (
                  <DetailEmpty>None.</DetailEmpty>
                )}
              </div>
            </div>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}
