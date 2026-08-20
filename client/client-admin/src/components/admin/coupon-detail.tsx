'use client';

import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import type { CouponRow, CouponView } from '@/lib/types';
import {
  DetailBool,
  DetailField,
  DetailGrid,
  DetailId,
  DetailSection,
  DetailSheet,
  DetailTable,
} from './detail-sheet';

/** How a coupon's value reads, which depends on what kind of discount it is. */
function couponValue(coupon: { type: string; value: string }, currency: string): string {
  if (coupon.type === 'percentage') return `${Number(coupon.value)}%`;
  if (coupon.type === 'free_shipping') return 'Free shipping';
  return formatMoney(coupon.value, currency);
}

/**
 * One coupon: the rules checkout enforces, and the ledger `used_count` is made
 * of.
 *
 * The count on the row is the figure the usage limit is checked against — it is
 * incremented inside the order transaction, so it is the only honest record of
 * how often a code has been claimed. The redemptions beside it are what it is
 * made of, and the pair is worth showing together because it is the only way to
 * tell a code used a hundred times by a hundred people from one used a hundred
 * times by the same person.
 */
export function CouponDetail({
  row,
  open,
  onOpenChange,
  currency,
}: {
  row: CouponRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const detail = useDetail<CouponView>({
    path: '/api/v1/admin/coupons',
    id: row?.id ?? null,
    enabled: open,
  });

  const coupon = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="font-mono">{coupon?.code ?? row?.code ?? 'Coupon'}</span>}
      subtitle={coupon?.description ?? row?.description ?? undefined}
      badge={<StatusBadge status={coupon?.status ?? row?.status ?? 'active'} />}
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
    >
      {coupon ? (
        <div className="space-y-6">
          <DetailSection title="The discount">
            <DetailGrid>
              <DetailField label="Code" value={coupon.code} mono />
              <DetailField label="Kind" value={titleCase(coupon.type)} />
              <DetailField label="Worth" value={couponValue(coupon, currency)} />
              <DetailField
                label="Capped at"
                value={formatMoney(coupon.maxDiscountAmount, currency)}
                hint={
                  coupon.type === 'percentage' && !coupon.maxDiscountAmount
                    ? 'Uncapped — a percentage off a large basket has no ceiling.'
                    : undefined
                }
              />
              <DetailField label="Minimum basket" value={formatMoney(coupon.minOrderAmount, currency)} />
              <DetailField
                label="Applies to"
                value={titleCase(coupon.scope)}
                hint={
                  coupon.targetIds?.length
                    ? `${coupon.targetIds.length} ${coupon.scope === 'category' ? 'categories' : 'products'} named.`
                    : undefined
                }
              />
              <DetailField
                label="Stacks with automatic discounts"
                value={<DetailBool value={coupon.isStackable} />}
              />
              <DetailField label="Coupon ID" value={<DetailId value={coupon.id} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="When it works">
            <DetailGrid>
              <DetailField label="Status" value={<StatusBadge status={coupon.status} />} />
              <DetailField
                label="Starts"
                value={formatDateTime(coupon.startsAt)}
                hint={coupon.startsAt ? undefined : 'Live as soon as it is active.'}
              />
              <DetailField
                label="Ends"
                value={formatDateTime(coupon.endsAt)}
                hint={coupon.endsAt ? undefined : 'No expiry.'}
              />
              <DetailField label="Created" value={formatDateTime(coupon.createdAt)} />
              <DetailField label="Updated" value={formatDateTime(coupon.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="How often it may be used">
            <DetailGrid>
              <DetailField
                label="Total uses allowed"
                value={coupon.usageLimit === null ? 'Unlimited' : formatNumber(coupon.usageLimit)}
              />
              <DetailField
                label="Per customer"
                value={coupon.perCustomerLimit === null ? 'Unlimited' : formatNumber(coupon.perCustomerLimit)}
                hint="A guest is counted by the email they checked out with."
              />
              <DetailField
                label="Claimed"
                value={formatNumber(coupon.usedCount)}
                hint="Incremented inside the order transaction; never edited by hand."
              />
              <DetailField
                label="Left"
                value={
                  coupon.usageLimit === null
                    ? 'Unlimited'
                    : formatNumber(Math.max(0, coupon.usageLimit - coupon.usedCount))
                }
              />
              <DetailField label="Given away" value={formatMoney(coupon.totalDiscounted, currency)} />
              <DetailField label="Redemption rows" value={formatNumber(coupon.redemptionCount)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Redemptions"
            action={
              coupon.redemptions.length >= 50 ? (
                <span className="text-xs text-muted-foreground">Most recent 50</span>
              ) : null
            }
          >
            <DetailTable
              rows={coupon.redemptions}
              rowKey={(entry) => entry.id}
              empty="Nobody has used this code yet."
              columns={[
                {
                  key: 'order',
                  header: 'Order',
                  cell: (entry) => (
                    <Link href={`/orders/${entry.orderId}`} className="font-mono text-[13px] hover:underline">
                      {entry.orderNumber ?? 'Open order'}
                    </Link>
                  ),
                },
                {
                  key: 'who',
                  header: 'Who',
                  cell: (entry) =>
                    entry.customerId ? (
                      <Link href={`/customers/${entry.customerId}`} className="hover:underline">
                        {entry.customerName ?? entry.email ?? 'Account'}
                      </Link>
                    ) : (
                      (entry.email ?? 'Guest')
                    ),
                },
                {
                  key: 'status',
                  header: 'Order status',
                  cell: (entry) => (entry.orderStatus ? <StatusBadge status={entry.orderStatus} /> : '—'),
                },
                {
                  key: 'amount',
                  header: 'Discount',
                  align: 'right',
                  cell: (entry) => formatMoney(entry.discountAmount, currency),
                },
                { key: 'when', header: 'When', cell: (entry) => formatDate(entry.createdAt) },
              ]}
            />
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}
