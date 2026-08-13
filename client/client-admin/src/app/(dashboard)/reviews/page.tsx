import type { Metadata } from 'next';
import { Star } from 'lucide-react';
import type { ReviewRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { ReviewModeration } from '@/components/admin/review-moderation';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All reviews' },
  { value: 'pending', label: 'Awaiting review' },
  { value: 'approved', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
];

export default async function ReviewsPage({
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
  const canManage = session.authenticated && can(session.admin, 'reviews.manage');

  const [{ data, meta }, pending] = await Promise.all([
    serverGetPaginated<ReviewRow>('/api/v1/admin/reviews', {
      page: single('page') ?? 1,
      search: single('search'),
      status: single('status'),
    }),
    // One cheap count for the "waiting" line, rather than a second shape bolted
    // onto the list response.
    serverGetPaginated<ReviewRow>('/api/v1/admin/reviews', { status: 'pending', pageSize: 1 }),
  ]);

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description={
          pending.meta.total > 0
            ? `${pending.meta.total} waiting for you. Nothing appears on your storefront until you approve it.`
            : 'Nothing appears on your storefront until you approve it.'
        }
      />

      <TableFilters searchPlaceholder="Customer, product or wording" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          description="When a customer reviews something they bought, it will wait for you here."
        />
      ) : data.length === 0 ? (
        <EmptyState icon={Star} title="Nothing matches those filters" />
      ) : (
        <>
          <ReviewModeration rows={data} canManage={canManage} />
          <Pagination {...meta} />
        </>
      )}
    </div>
  );
}
