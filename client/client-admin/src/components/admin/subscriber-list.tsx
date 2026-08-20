'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListMeta } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { SubscriberRow } from '@/lib/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { InfiniteTable, type Column } from './infinite-table';
import { SubscriberActions } from './subscriber-actions';
import { SubscriberDetail } from './subscriber-detail';

/**
 * The mailing list, appended by cursor as the reader scrolls.
 *
 * This is the screen the change was most needed on: a list nobody deletes from
 * — an unsubscribe marks the row rather than removing it — grows in one
 * direction forever, and a shop of any age had page numbers running into the
 * hundreds.
 */
export function SubscriberList({
  initial,
  query,
  filtered,
  canManage,
}: {
  initial: { rows: SubscriberRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  filtered: boolean;
  canManage: boolean;
}) {
  const list = useInfiniteList<SubscriberRow>({ path: '/api/v1/admin/newsletter', query, initial });

  /** One panel for the whole list; a row's button names which record it shows. */
  const viewing = useViewTarget<SubscriberRow>();

  const columns: Column<SubscriberRow>[] = [
    {
      key: 'email',
      header: 'Email',
      className: 'font-medium',
      cell: (row) => <span className="block truncate">{row.email}</span>,
    },
    {
      key: 'joined',
      width: '10rem',
      header: 'Joined',
      className: 'text-sm text-muted-foreground',
      cell: (row) => formatDate(row.subscribedAt),
    },
    {
      key: 'source',
      width: '10rem',
      header: 'Where from',
      className: 'text-sm text-muted-foreground',
      cell: (row) => <span className="block truncate">{row.source ?? '—'}</span>,
    },
    {
      key: 'status',
      width: '9rem',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      width: '13rem',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`View ${row.email}`}
            onClick={() => viewing.view(row)}
          >
            <Eye />
          </Button>
          <SubscriberActions subscriber={row} canManage={canManage} />
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
        noun="subscriber"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="56rem"
        estimateRowHeight={57}
        empty={filtered ? 'Nobody matches those filters.' : 'Nobody has signed up yet.'}
      />

      <SubscriberDetail row={viewing.row} open={viewing.open} onOpenChange={viewing.onOpenChange} />
    </>
  );
}
