'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import type { ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { PageRow } from '@/lib/types';
import { useT, type MessageKey } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { InfiniteTable, type Column } from './infinite-table';
import { PageDetail } from './page-detail';

const STATUS_LABELS: Record<PageRow['status'], MessageKey> = {
  draft: 'Draft',
  published: 'Published',
};

/** CMS pages, appended by cursor as the reader scrolls. See `InfiniteTable`. */
export function PageList({
  initial,
  query,
  filtered,
  storefrontBase,
}: {
  initial: { rows: PageRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  filtered: boolean;
  /** Null when the store's public address is not known to this deployment. */
  storefrontBase: string | null;
}) {
  const t = useT();
  const list = useInfiniteList<PageRow>({ path: '/api/v1/admin/website/pages', query, initial });

  /*
   * The read-only panel. It is the only place `body_html` is legible without
   * opening the editor — and it shows it as source, which is what is stored and
   * what the storefront renders.
   */
  const viewing = useViewTarget<PageRow>();

  const columns: Column<PageRow>[] = [
    {
      key: 'title',
      header: t('Title'),
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/website/pages/${row.id}`} className="truncate font-medium hover:underline">
            {row.title}
          </Link>
          {row.systemKey ? <Badge variant="info">{t('Policy')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'slug',
      width: '16rem',
      header: t('Address'),
      className: 'font-mono text-xs text-muted-foreground',
      cell: (row) => <span className="block truncate">/page/{row.slug}</span>,
    },
    {
      key: 'status',
      width: '9rem',
      header: t('Status'),
      cell: (row) => <StatusBadge status={row.status} label={t(STATUS_LABELS[row.status])} />,
    },
    {
      key: 'footer',
      width: '8rem',
      header: t('In footer'),
      className: 'text-sm text-muted-foreground',
      cell: (row) => (row.showInFooter ? t('Yes') : '—'),
    },
    {
      key: 'updated',
      width: '10rem',
      header: t('Updated'),
      className: 'text-sm text-muted-foreground',
      cell: (row) => t.relative(row.updatedAt),
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
          aria-label={t('View {name}', { name: row.title })}
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
        noun="page"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="60rem"
        estimateRowHeight={53}
        empty={filtered ? t('No page matches those filters.') : t('No pages yet.')}
      />

      <PageDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        storefrontBase={storefrontBase}
      />
    </>
  );
}
