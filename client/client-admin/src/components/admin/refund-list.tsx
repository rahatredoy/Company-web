'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListMeta } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { RefundRow } from '@/lib/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { InfiniteTable, type Column } from './infinite-table';
import { RefundActions } from './refund-actions';
import { RefundDetail } from './refund-detail';

/**
 * Refunds, appended by cursor as the reader scrolls. See `InfiniteTable`.
 *
 * The eye opens the refund beside the list, with the two things the row cannot
 * carry and a decision needs: how much is still refundable on the order, and how
 * the money arrived in the first place.
 */
export function RefundList({
  initial,
  query,
  filtered,
  canApprove,
}: {
  initial: { rows: RefundRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  filtered: boolean;
  canApprove: boolean;
}) {
  const t = useT();
  const list = useInfiniteList<RefundRow>({ path: '/api/v1/admin/refunds', query, initial });

  /** One panel for the whole list; a row's button names which record it shows. */
  const viewing = useViewTarget<RefundRow>();

  const columns: Column<RefundRow>[] = [
    {
      key: 'refund',
      header: t('Refund'),
      cell: (row) => (
        <>
          <span className="block font-mono text-sm font-medium">{row.refundNumber}</span>
          <span className="block truncate text-xs text-muted-foreground">{row.customerName}</span>
        </>
      ),
    },
    {
      key: 'order',
      width: '10rem',
      header: t('Order'),
      cell: (row) => (
        <Link href={`/orders?view=${row.orderId}`} className="font-mono text-sm hover:underline">
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: 'raised',
      width: '10rem',
      header: t('Raised'),
      className: 'text-sm text-muted-foreground',
      cell: (row) => t.date(row.createdAt),
    },
    {
      key: 'status',
      width: '10rem',
      header: t('Status'),
      cell: (row) => (
        <>
          <StatusBadge status={row.status} />
          {row.method ? <span className="block text-xs text-muted-foreground">{t('via {method}', { method: row.method })}</span> : null}
        </>
      ),
    },
    {
      key: 'amount',
      width: '9rem',
      header: t('Amount'),
      headClassName: 'text-right',
      className: 'text-right font-medium tabular-nums',
      cell: (row) => t.money(row.amount, row.currency),
    },
    {
      key: 'actions',
      width: '20rem',
      header: '',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('View refund {number}', { number: row.refundNumber })}
            onClick={() => viewing.view(row)}
          >
            <Eye />
          </Button>
          <RefundActions refund={row} canApprove={canApprove} />
        </div>
      ),
    },
  ];

  return (
    <>
      <InfiniteTable
        columns={columns}
        rows={list.rows}
        total={list.total}
        noun="refund"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="76rem"
        estimateRowHeight={66}
        empty={filtered ? t('No refund matches those filters.') : t('No refunds yet.')}
      />

      <RefundDetail row={viewing.row} open={viewing.open} onOpenChange={viewing.onOpenChange} />
    </>
  );
}
