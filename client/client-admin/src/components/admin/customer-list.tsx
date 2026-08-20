'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListMeta } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { CustomerRow } from '@/lib/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { CustomerDetail } from './customer-detail';
import { InfiniteTable, type Column } from './infinite-table';

/**
 * The customer list. The server renders the first batch and this appends the
 * rest by cursor as the reader nears the bottom — no page numbers, and only the
 * visible rows in the DOM, which is what keeps a shop with fifty thousand
 * accounts as responsive as one with fifty.
 *
 * The eye opens the whole account beside the list rather than navigating to it:
 * a virtualised list cannot have its scroll position restored by the browser, so
 * a look at one row used to cost the reader their place in the list.
 */
export function CustomerList({
  initial,
  currency,
  query,
  filtered,
}: {
  initial: { rows: CustomerRow[]; meta: ListMeta };
  currency: string;
  /** The filters the first batch was read with; every later batch repeats them. */
  query: Record<string, string | undefined>;
  filtered: boolean;
}) {
  const list = useInfiniteList<CustomerRow>({ path: '/api/v1/admin/customers', query, initial });

  /** One panel for the whole list; a row's button names which record it shows. */
  const viewing = useViewTarget<CustomerRow>();

  const columns: Column<CustomerRow>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <>
          <Link href={`/customers/${row.id}`} className="block truncate font-medium hover:underline">
            {row.fullName}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
        </>
      ),
    },
    {
      key: 'joined',
      width: '10rem',
      header: 'Joined',
      className: 'text-sm text-muted-foreground',
      cell: (row) => formatDate(row.createdAt),
    },
    {
      key: 'status',
      width: '8rem',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'orders',
      width: '7rem',
      header: 'Orders',
      headClassName: 'text-right',
      className: 'text-right tabular-nums',
      cell: (row) => row.orderCount,
    },
    {
      key: 'spent',
      width: '9rem',
      header: 'Spent',
      headClassName: 'text-right',
      className: 'text-right font-medium tabular-nums',
      cell: (row) => formatMoney(row.totalSpent, currency),
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
          aria-label={`View ${row.fullName}`}
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
        noun="customer"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="52rem"
        estimateRowHeight={62}
        empty={filtered ? 'No customer matches those filters.' : 'No customers yet.'}
      />

      <CustomerDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        currency={currency}
      />
    </>
  );
}
