import type { Metadata } from 'next';
import { Star } from 'lucide-react';
import type { ReviewRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { currentStoreSlug, serverGet, serverGetListed } from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
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

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = { search: single('search'), status: single('status') };

  const [slug, first, pending] = await Promise.all([
    // For the view panel's link out to the product a review is attached to.
    currentStoreSlug(),
    serverGetListed<ReviewRow>('/api/v1/admin/reviews', { ...query, pageSize: BATCH_SIZE }),
    // One cheap count for the "waiting" line, rather than a second shape bolted
    // onto the list response. Uncursored and one row wide, so it pays for the
    // tally and nothing else.
    serverGetListed<ReviewRow>('/api/v1/admin/reviews', { status: 'pending', pageSize: 1 }),
  ]);

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description={
          (pending.meta.total ?? 0) > 0
            ? `${pending.meta.total} waiting for you. Nothing appears on your storefront until you approve it.`
            : 'Nothing appears on your storefront until you approve it.'
        }
      />

      <TableFilters searchPlaceholder="Customer, product or wording" statusOptions={STATUS_OPTIONS} />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          description="When a customer reviews something they bought, it will wait for you here."
        />
      ) : (
        <ReviewModeration
          initial={{ rows: first.data, meta: first.meta }}
          query={query}
          canManage={canManage}
          filtered={filtered}
          storefrontBase={slug ? storefrontUrl(slug) : null}
        />
      )}
    </div>
  );
}
