import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { SubscriptionActions } from '@/components/admin/subscription-actions';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { listOrEmpty } from '@/lib/admin-api';
import { formatDate, formatMoney, titleCase } from '@/lib/format';
import type { SubscriptionRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Subscriptions' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past Due' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'suspended', label: 'Suspended' },
];

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const {
    data: subscriptions,
    meta,
    unavailable,
  } = await listOrEmpty<SubscriptionRow>('/api/v1/admin/subscriptions', params);

  return (
    <>
      <PageHeader title="Subscriptions" description="Every subscription across the platform." />

      {unavailable ? <ApiUnavailable resource="The subscription list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters searchPlaceholder="Search by business name or plan…" statusOptions={STATUS_FILTERS} />
      </Suspense>

      {subscriptions.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No subscriptions found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Renewal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <Link
                          href={`/clients/${subscription.clientId}`}
                          className="font-medium hover:text-primary"
                        >
                          {subscription.businessName}
                        </Link>
                      </TableCell>
                      <TableCell>{subscription.planName ?? '—'}</TableCell>
                      <TableCell>{subscription.billingCycle ? titleCase(subscription.billingCycle) : '—'}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {subscription.price ? formatMoney(subscription.price, subscription.currency) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(subscription.startedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(subscription.renewalAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={subscription.status} />
                      </TableCell>
                      <TableCell>
                        <SubscriptionActions subscription={subscription} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}

      <Suspense fallback={null}>
        <Pagination {...meta} />
      </Suspense>
    </>
  );
}
