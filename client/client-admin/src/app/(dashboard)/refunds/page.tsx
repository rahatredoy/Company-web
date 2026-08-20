import type { Metadata } from 'next';
import { Wallet } from 'lucide-react';
import type { RefundRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { RefundList } from '@/components/admin/refund-list';
import { TableFilters } from '@/components/admin/table-filters';

export const metadata: Metadata = { title: 'Refunds' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All refunds' },
  { value: 'requested', label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
];

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const canApprove = session.authenticated && can(session.admin, 'refunds.approve');

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = { search: single('search'), status: single('status') };
  const first = await serverGetListed<RefundRow>('/api/v1/admin/refunds', {
    ...query,
    pageSize: BATCH_SIZE,
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Money going back out. A refund is raised by a completed return and paid here."
      />

      <TableFilters searchPlaceholder="Refund or order number" statusOptions={STATUS_OPTIONS} />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={Wallet}
          title="No refunds"
          description="Completing a return raises one here for approval."
        />
      ) : (
        <RefundList
          initial={{ rows: first.data, meta: first.meta }}
          query={query}
          filtered={filtered}
          canApprove={canApprove}
        />
      )}
    </div>
  );
}
