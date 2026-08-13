import type { Metadata } from 'next';
import { MessageSquareText } from 'lucide-react';
import type { SessionResponse, SubscriberRow } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatDate } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { SubscriberActions } from '@/components/admin/subscriber-actions';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';

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

  const [{ data, meta }, subscribed] = await Promise.all([
    serverGetPaginated<SubscriberRow>('/api/v1/admin/newsletter', {
      page: single('page') ?? 1,
      search: single('search'),
      status: single('status'),
    }),
    serverGetPaginated<SubscriberRow>('/api/v1/admin/newsletter', { status: 'subscribed', pageSize: 1 }),
  ]);

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Newsletter"
        description={`${subscribed.meta.total} ${subscribed.meta.total === 1 ? 'person is' : 'people are'} subscribed. Sending is not built yet — this is the list.`}
      />

      <TableFilters searchPlaceholder="Email address" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={MessageSquareText}
          title="Nobody has signed up yet"
          description="The sign-up form sits at the bottom of your storefront."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Where from</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={5}>Nobody matches those filters.</TableEmpty>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(row.subscribedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.source ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <SubscriberActions subscriber={row} canManage={canManage} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
          <Pagination {...meta} />
        </>
      )}
    </div>
  );
}
