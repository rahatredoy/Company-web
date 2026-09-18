'use client';

import * as React from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import type { DiscountRow, DiscountView } from '@/lib/types';
import { useDetail } from '@/hooks/use-detail';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { KIND_META, STATE_META, longDateTime, previewRows } from '@/lib/discounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DetailCard,
  DetailColumns,
  DetailFactList,
  DetailSection,
  DetailSheet,
  DetailStat,
  DetailTable,
  keepFacts,
} from './detail-sheet';

/**
 * One discount, read-only: what it does in the same sentences the editor's
 * Review step uses, what it has done, and the ledger that is made of.
 */
export function DiscountDetail({
  row,
  open,
  onOpenChange,
  onEdit,
}: {
  row: DiscountRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (id: string) => void;
}) {
  const detail = useDetail<DiscountView>({ path: '/api/v1/admin/discounts', id: row?.id ?? null, enabled: open });
  const view = detail.data && detail.data.id === row?.id ? detail.data : null;

  const state = view?.state ?? row?.state;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={row?.name ?? 'Discount'}
      subtitle={row ? `${KIND_META[row.kind].label}${row.code ? ` · ${row.code}` : ''}` : undefined}
      badge={state ? <Badge variant={STATE_META[state].variant}>{STATE_META[state].label}</Badge> : null}
      loading={detail.loading && !view}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        onEdit && row ? (
          <Button size="sm" onClick={() => onEdit(row.id)}>
            <Pencil aria-hidden /> Edit
          </Button>
        ) : null
      }
    >
      {view ? <DiscountBody view={view} /> : null}
    </DetailSheet>
  );
}

function DiscountBody({ view }: { view: DiscountView }) {
  const { analytics } = view;
  const currency = analytics.currency;
  const zone = view.resolvedTimezone;

  const rules = previewRows(
    { ...view, customerCount: view.customerCount },
    { currency, timeZone: zone, names: (id) => view.labels[id]?.label },
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <DetailStat
          label="Uses"
          value={formatNumber(analytics.uses)}
          sub={view.usageLimit ? `of ${formatNumber(view.usageLimit)} allowed` : 'No total limit'}
        />
        <DetailStat label="Discount given" value={formatMoney(analytics.discountGiven, currency)} />
        <DetailStat label="Order value" value={formatMoney(analytics.orderValue, currency)} sub={`Average ${formatMoney(analytics.averageOrderValue, currency)}`} />
        <DetailStat
          label="Order share"
          value={analytics.orderShare === null ? '—' : `${Math.round(analytics.orderShare * 1000) / 10}%`}
          sub={`of ${formatNumber(analytics.ordersWhileLive)} orders while live`}
        />
      </div>

      <DetailColumns>
        <DetailCard title="What it does">
          <DetailFactList facts={rules.map((entry) => ({ label: entry.label, value: entry.value, stacked: true }))} />
        </DetailCard>
        <DetailCard title="Record">
          <DetailFactList
            facts={keepFacts([
              view.title ? { label: 'Shown to customers', value: view.title, stacked: true } : null,
              view.summary ? { label: 'Summary', value: view.summary, stacked: true } : null,
              view.notes ? { label: 'Private note', value: view.notes, stacked: true } : null,
              { label: 'Priority', value: String(view.priority) },
              { label: 'Timezone', value: zone },
              { label: 'Starts', value: longDateTime(view.startsAt, zone) },
              { label: 'Ends', value: view.endsAt ? longDateTime(view.endsAt, zone) : 'No expiry' },
              { label: 'Unique customers', value: formatNumber(analytics.uniqueCustomers) },
              analytics.voidedUses ? { label: 'Voided uses', value: formatNumber(analytics.voidedUses) } : null,
              analytics.firstUsedAt ? { label: 'First used', value: formatDateTime(analytics.firstUsedAt) } : null,
              analytics.lastUsedAt ? { label: 'Last used', value: formatDateTime(analytics.lastUsedAt) } : null,
              { label: 'Created', value: formatDateTime(view.createdAt) },
              { label: 'Last edited', value: formatDateTime(view.updatedAt) },
            ])}
          />
        </DetailCard>
      </DetailColumns>

      {view.canSeeCustomers && view.customerCount > 0 ? (
        <DetailSection
          title="Customers"
          action={
            <span className="text-xs text-muted-foreground">
              {formatNumber(view.customersUsed)} of {formatNumber(view.customerCount)} used
            </span>
          }
        >
          <DetailTable
            rows={view.customers}
            rowKey={(entry) => entry.id}
            columns={[
              {
                key: 'customer',
                header: 'Customer',
                cell: (entry) => (
                  <Link href={`/customers?view=${entry.customerId}`} className="hover:underline">
                    <span className="block">{entry.name}</span>
                    <span className="block text-xs text-muted-foreground">{entry.email ?? entry.phone ?? ''}</span>
                  </Link>
                ),
              },
              { key: 'source', header: 'Added', cell: (entry) => (entry.source === 'reward' ? 'Issued by a rule' : 'By you') },
              { key: 'issued', header: 'On', cell: (entry) => formatDate(entry.issuedAt) },
              { key: 'expires', header: 'Expires', cell: (entry) => (entry.expiresAt ? formatDate(entry.expiresAt) : '—') },
              { key: 'used', header: 'Used', cell: (entry) => (entry.usedAt ? formatDate(entry.usedAt) : 'Not yet') },
            ]}
          />
        </DetailSection>
      ) : null}

      <DetailSection title="Recent uses">
        <DetailTable
          rows={view.redemptions}
          rowKey={(entry) => entry.id}
          empty="Nobody has used this discount yet."
          columns={[
            {
              key: 'order',
              header: 'Order',
              cell: (entry) => (
                <Link href={`/orders?view=${entry.orderId}`} className="font-mono text-[12px] hover:underline">
                  {entry.orderNumber ?? 'Open order'}
                </Link>
              ),
            },
            {
              key: 'customer',
              header: 'Customer',
              cell: (entry) => (
                <>
                  <span className="block">{entry.customerName ?? 'Guest'}</span>
                  {entry.email ? <span className="block text-xs text-muted-foreground">{entry.email}</span> : null}
                </>
              ),
            },
            {
              key: 'amount',
              header: 'Discount',
              align: 'right',
              // The order's own currency: a use taken before the store switched was given in the old one.
              cell: (entry) => (
                <span className={entry.voidedAt ? 'text-muted-foreground line-through' : undefined}>
                  {formatMoney(entry.discountAmount, entry.currency ?? currency)}
                </span>
              ),
            },
            { key: 'when', header: 'When', cell: (entry) => formatDate(entry.createdAt) },
          ]}
        />
      </DetailSection>
    </div>
  );
}
