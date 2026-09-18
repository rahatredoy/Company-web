import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw, Wallet } from 'lucide-react';
import type { RefundRow, ReturnRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetListed, serverGetOptional } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { RefundList } from '@/components/admin/refund-list';
import { ReturnList } from '@/components/admin/return-list';
import { TableFilters } from '@/components/admin/table-filters';
import type { MessageKey } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Returns & refunds') };
}

export const dynamic = 'force-dynamic';

const RETURN_STATUS_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'All returns' },
  { value: 'requested', label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'received', label: 'Received' },
  { value: 'inspected', label: 'Inspected' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

const REFUND_STATUS_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'All refunds' },
  { value: 'requested', label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
];

type Tab = 'returns' | 'refunds';

/**
 * Returns and refunds on one screen, as two tabs. A refund is raised by a
 * completed return, so the two are one piece of work read from two ends.
 *
 * The tab is in the URL (`?tab=refunds`) rather than in client state, so each
 * tab is still its own server-rendered first batch, `/refunds` can redirect
 * straight onto its tab, and a refresh keeps the reader where they were.
 * Switching tab drops the search and status: the two lists do not share
 * statuses, so carrying one across would filter on a value the other lacks.
 */
export default async function ReturnsAndRefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const t = await getT();
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const admin = session.authenticated ? session.admin : null;
  const canReturns = can(admin, 'returns.view');
  const canRefunds = can(admin, 'refunds.view');
  const canApprove = can(admin, 'refunds.approve');
  const canApproveReturns = can(admin, 'returns.approve');

  // A tab the admin may not read is not drawn, and is never the one shown.
  const tab: Tab = (single('tab') === 'refunds' && canRefunds) || !canReturns ? 'refunds' : 'returns';
  const tabs: { key: Tab; label: MessageKey; href: string }[] = [
    ...(canReturns ? [{ key: 'returns' as const, label: 'Returns' as const, href: '/returns' }] : []),
    ...(canRefunds ? [{ key: 'refunds' as const, label: 'Refunds' as const, href: '/returns?tab=refunds' }] : []),
  ];

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list — a cursor into one means nothing in
  // another. No cursor on this one, which is what makes the API count.
  const query = { search: single('search'), status: single('status') };
  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));
  const statusOptions = tab === 'refunds' ? REFUND_STATUS_OPTIONS : RETURN_STATUS_OPTIONS;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Returns & refunds')}
        description={t('What customers send back, and the money that goes back to them.')}
      />

      {tabs.length > 1 ? (
        <nav aria-label={t('Returns & refunds')} className="scroll-x inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1">
          {tabs.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={tab === item.key ? 'page' : undefined}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all',
                tab === item.key
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.key === 'refunds' ? <Wallet className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
              {t(item.label)}
            </Link>
          ))}
        </nav>
      ) : null}

      <TableFilters
        key={tab}
        searchPlaceholder={tab === 'refunds' ? t('Refund or order number') : t('Return or order number')}
        statusOptions={statusOptions.map((option) => ({ value: option.value, label: t(option.label) }))}
        preserveParams={['tab']}
      />

      {tab === 'refunds' ? <RefundsTab query={query} filtered={filtered} canApprove={canApprove} /> : <ReturnsTab query={query} filtered={filtered} canApprove={canApproveReturns} viewId={single('view')} />}
    </div>
  );
}

type ListQuery = { search: string | undefined; status: string | undefined };

async function ReturnsTab({
  query,
  filtered,
  canApprove,
  viewId,
}: {
  query: ListQuery;
  filtered: boolean;
  canApprove: boolean;
  viewId: string | undefined;
}) {
  const t = await getT();
  // `?view=<id>` is how every other screen links to one return: the list opens
  // with its panel showing. An id that names nothing just opens the list.
  const [first, initialView] = await Promise.all([
    serverGetListed<ReturnRow>('/api/v1/admin/returns', { ...query, pageSize: BATCH_SIZE }),
    viewId && /^[0-9a-f-]{36}$/i.test(viewId)
      ? serverGetOptional<ReturnRow>(`/api/v1/admin/returns/${viewId}`)
      : Promise.resolve(null),
  ]);

  if (first.data.length === 0 && !filtered) {
    return (
      <EmptyState
        icon={RotateCcw}
        title={t('No returns')}
        description={t('A customer can request one from their own order page after it is delivered.')}
      />
    );
  }
  return (
    <ReturnList
      initial={{ rows: first.data, meta: first.meta }}
      query={query}
      filtered={filtered}
      canApprove={canApprove}
      initialView={initialView}
    />
  );
}

async function RefundsTab({ query, filtered, canApprove }: { query: ListQuery; filtered: boolean; canApprove: boolean }) {
  const t = await getT();
  const first = await serverGetListed<RefundRow>('/api/v1/admin/refunds', { ...query, pageSize: BATCH_SIZE });

  if (first.data.length === 0 && !filtered) {
    return (
      <EmptyState
        icon={Wallet}
        title={t('No refunds')}
        description={t('Completing a return raises one here for approval.')}
      />
    );
  }
  return (
    <RefundList
      initial={{ rows: first.data, meta: first.meta }}
      query={query}
      filtered={filtered}
      canApprove={canApprove}
    />
  );
}
