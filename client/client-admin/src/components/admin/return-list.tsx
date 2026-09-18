'use client';

import Link from 'next/link';
import { Camera, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListMeta } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useAddressedView } from '@/hooks/use-detail';
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
  canApprove,
  initialView,
}: {
  initial: { rows: ReturnRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  filtered: boolean;
  canApprove: boolean;
  /** A return named by `?view=<id>` — how every other screen links to one. */
  initialView: ReturnRow | null;
}) {
  const t = useT();
  const list = useInfiniteList<ReturnRow>({ path: '/api/v1/admin/returns', query, initial });

  /** One panel for the whole list; a row's button names which record it shows. */
  const viewing = useAddressedView<ReturnRow>(initialView);

  const columns: Column<ReturnRow>[] = [
    {
      key: 'return',
      width: '12rem',
      header: t('Return'),
      cell: (row) => (
        <>
          <button
            type="button"
            onClick={() => viewing.view(row)}
            className="block font-mono text-sm font-medium hover:underline"
          >
            {row.returnNumber}
          </button>
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
      key: 'requested',
      width: '10rem',
      header: t('Requested'),
      className: 'text-sm text-muted-foreground',
      cell: (row) => t.date(row.createdAt),
    },
    {
      key: 'reason',
      header: t('Reason'),
      className: 'text-sm',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{t.loose(titleCase(row.reason))}</span>
          {row.photoCount > 0 ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title={t.plural(row.photoCount, '{count} photo', '{count} photos', { count: row.photoCount })}
            >
              <Camera className="size-3" aria-hidden />
              {t.number(row.photoCount)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'status',
      width: '9rem',
      header: t('Status'),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'refundable',
      width: '9rem',
      header: t('Refundable'),
      headClassName: 'text-right',
      className: 'text-right tabular-nums',
      cell: (row) => t.money(row.refundableAmount, row.currency),
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
          aria-label={t('View return {number}', { number: row.returnNumber })}
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
        empty={filtered ? t('No return matches those filters.') : t('No returns yet.')}
      />

      <ReturnDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        canApprove={canApprove}
      />
    </>
  );
}
