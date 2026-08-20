import type { Metadata } from 'next';
import { MessageSquareText } from 'lucide-react';
import type { SessionResponse, SubscriberRow } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { SubscriberList } from '@/components/admin/subscriber-list';
import { TableFilters } from '@/components/admin/table-filters';

export const metadata: Metadata = { title: 'Newsletter' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'subscribed', label: 'Subscribed' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
];

export default async function NewsletterPage({
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
  const canManage = session.authenticated && can(session.admin, 'marketing.manage');

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = { search: single('search'), status: single('status') };

  const [first, subscribed] = await Promise.all([
    serverGetListed<SubscriberRow>('/api/v1/admin/newsletter', { ...query, pageSize: BATCH_SIZE }),
    // One cheap count for the heading. Asked for without a cursor and with a
    // single row, so it pays for the tally and nothing else.
    serverGetListed<SubscriberRow>('/api/v1/admin/newsletter', { status: 'subscribed', pageSize: 1 }),
  ]);

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Newsletter"
        description={`${subscribed.meta.total ?? 0} ${subscribed.meta.total === 1 ? 'person is' : 'people are'} subscribed. Sending is not built yet — this is the list.`}
      />

      <TableFilters searchPlaceholder="Email address" statusOptions={STATUS_OPTIONS} />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={MessageSquareText}
          title="Nobody has signed up yet"
          description="The sign-up form sits at the bottom of your storefront."
        />
      ) : (
        <SubscriberList
          initial={{ rows: first.data, meta: first.meta }}
          query={query}
          filtered={filtered}
          canManage={canManage}
        />
      )}
    </div>
  );
}
