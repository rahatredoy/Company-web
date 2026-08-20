import type { Metadata } from 'next';
import { RotateCcw } from 'lucide-react';
import type { ReturnRow } from '@/lib/types';
import { serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { ReturnList } from '@/components/admin/return-list';
import { TableFilters } from '@/components/admin/table-filters';

export const metadata: Metadata = { title: 'Returns' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All returns' },
  { value: 'requested', label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'received', label: 'Received' },
  { value: 'inspected', label: 'Inspected' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list — a cursor into one means nothing in
  // another. No cursor on this one, which is what makes the API count.
  const query = { search: single('search'), status: single('status') };
  const first = await serverGetListed<ReturnRow>('/api/v1/admin/returns', {
    ...query,
    pageSize: BATCH_SIZE,
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader title="Returns" description="What customers have asked to send back." />
      <TableFilters searchPlaceholder="Return or order number" statusOptions={STATUS_OPTIONS} />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={RotateCcw}
          title="No returns"
          description="A customer can request one from their own order page after it is delivered."
        />
      ) : (
        <ReturnList initial={{ rows: first.data, meta: first.meta }} query={query} filtered={filtered} />
      )}
    </div>
  );
}
