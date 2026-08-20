'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListMeta } from '@/lib/api';
import { formatDate, formatMoney, titleCase } from '@/lib/format';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { ReturnRow } from '@/lib/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { InfiniteTable, type Column } from './infinite-table';
import { ReturnDetail } from './return-detail';

/**
 * Returns, appended by cursor as the reader scrolls. See `InfiniteTable`.
 *
 * The eye opens the request beside the list — the lines, the inspection result
 * per line, the photographs the customer attached and the refunds it raised —
 * none of which the five columns here have room for.
 */
export function ReturnList({
  initial,
  query,
  filtered,
}: {
  initial: { rows: ReturnRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  filtered: boolean;
}) {
  const list = useInfiniteList<ReturnRow>({ path: '/api/v1/admin/returns', query, initial });

  /** One panel for the whole list; a row's button names which record it shows. */
  const viewing = useViewTarget<ReturnRow>();

  const columns: Column<ReturnRow>[] = [
    {
      key: 'return',
      width: '12rem',
      header: 'Return',
      cell: (row) => (
        <>
          <Link href={`/returns/${row.id}`} className="block font-mono text-sm font-medium hover:underline">
            {row.returnNumber}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">{row.customerName}</span>
        </>
      ),
    },
    {
      key: 'order',
      width: '10rem',
      header: 'Order',
      cell: (row) => (
        <Link href={`/orders/${row.orderId}`} className="font-mono text-sm hover:underline">
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: 'requested',
      width: '10rem',
      header: 'Requested',
      className: 'text-sm text-muted-foreground',
      cell: (row) => formatDate(row.createdAt),
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'text-sm',
      cell: (row) => <span className="block truncate">{titleCase(row.reason)}</span>,
    },
    {
      key: 'status',
      width: '9rem',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'refundable',
      width: '9rem',
      header: 'Refundable',
      headClassName: 'text-right',
      className: 'text-right tabular-nums',
      cell: (row) => formatMoney(row.refundableAmount, row.currency),
    },
    {
      key: 'view',
      width: '4.5rem',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`View return ${row.returnNumber}`}
          onClick={() => viewing.view(row)}
        >
          <Eye />
        </Button>
      ),
    },
  ];

  return (
    <>
      <InfiniteTable
        columns={columns}
        rows={list.rows}
        total={list.total}
        noun="return"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="66rem"
        estimateRowHeight={62}
        empty={filtered ? 'No return matches those filters.' : 'No returns yet.'}
      />

      <ReturnDetail row={viewing.row} open={viewing.open} onOpenChange={viewing.onOpenChange} />
    </>
  );
}
