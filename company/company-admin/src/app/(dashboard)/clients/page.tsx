import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
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
import { formatDate, formatDateTime, formatDateTimeShort, formatMoney } from '@/lib/format';
import type { ClientRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Clients' };

/**
 * "Signed up only" and "Customers" split the list by whether the account ever
 * took the service: the first is everyone who registered on the website and
 * never picked a plan, the second everyone on a trial or paying. The rest filter
 * within the customers by subscription or account state.
 */
/**
 * This table carries thirteen facts about every client, and one column each made
 * it wider than any laptop — the whole row had to be scrolled sideways to be
 * read. Related facts are paired into a single cell instead (business + tenant,
 * plan + subscription, store + domain, account + amount…), which keeps every
 * fact on screen and fits the row inside the page. Badges run a size smaller
 * because two of them now share a cell.
 */
const CELL_BADGE = 'px-1.5 py-0 text-[10.5px]';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'signup_only', label: 'Signed up only' },
  { value: 'customer', label: 'Customers' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'paid', label: 'Paid' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: clients, meta, unavailable } = await listOrEmpty<ClientRow>('/api/v1/admin/clients', params);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Every business registered on the platform."
      />

      {unavailable ? <ApiUnavailable resource="The client list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters
          searchPlaceholder="Search business name, website or panel login, phone, tenant ID or domain…"
          statusOptions={STATUS_FILTERS}
        />
      </Suspense>

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients found"
          description="No client matches the current filters. Reset them to see everything."
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table className="[&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
                <TableHeader>
                  <TableRow>
                    <TableHead>Business</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Logins</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Trial</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead>Account</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <Link href={`/clients/${client.id}`} className="block max-w-44 min-w-0">
                          <span className="block truncate font-medium hover:text-primary">
                            {client.businessName}
                          </span>
                          <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                            {client.tenantId ?? 'no tenant yet'}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="block max-w-36 truncate">{client.ownerName}</span>
                        <span className="block text-[10.5px] text-muted-foreground">{client.phone ?? '—'}</span>
                      </TableCell>
                      {/*
                        Two different logins: the website account, and the store
                        admin panel's own. Changing one never touches the other,
                        so support has to be able to read both at a glance. The
                        full address is on the row's title, because the column is
                        narrow enough to truncate the long ones.
                      */}
                      <TableCell>
                        <dl className="max-w-52 min-w-0 space-y-0.5 text-[10.5px]">
                          <div className="flex gap-1.5" title={client.email}>
                            <dt className="w-9 shrink-0 text-muted-foreground">Web</dt>
                            <dd className="truncate">{client.email}</dd>
                          </div>
                          <div className="flex gap-1.5" title={client.storeAdminEmail ?? undefined}>
                            <dt className="w-9 shrink-0 text-muted-foreground">Panel</dt>
                            <dd className="truncate">
                              {client.storeAdminEmail ? (
                                <>
                                  {client.storeAdminEmail}
                                  {/*
                                    Before the store is built the address is only
                                    staged, and setup will not provision until a
                                    passcode confirms it.
                                  */}
                                  {client.storeStatus !== 'ready' && !client.storeAdminEmailVerified ? (
                                    <span className="ml-1 text-warning">unconfirmed</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-muted-foreground">no store yet</span>
                              )}
                            </dd>
                          </div>
                        </dl>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="block">{client.planName ?? '—'}</span>
                        {client.subscriptionStatus ? (
                          <StatusBadge
                            status={client.subscriptionStatus}
                            className={`mt-0.5 ${CELL_BADGE}`}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {client.trialStatus ? (
                          <>
                            <StatusBadge status={client.trialStatus} className={CELL_BADGE} />
                            <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                              {formatDate(client.trialEndsAt)}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {client.storeStatus ? (
                          <StatusBadge status={client.storeStatus} className={CELL_BADGE} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        <span
                          className="mt-0.5 block max-w-40 truncate text-[10.5px] text-muted-foreground"
                          title={client.domain ?? undefined}
                        >
                          {client.domain ?? 'no domain'}
                        </span>
                      </TableCell>
                      {/*
                        Registration date on top, the last sign-in named under it —
                        support reads the two together, and the label has to be on
                        the row itself now that the column header names only the
                        first. The year is dropped from the sign-in while it is the
                        current one; the full stamp stays on hover.
                      */}
                      <TableCell className="whitespace-nowrap">
                        <span className="block">{formatDate(client.registeredAt)}</span>
                        <span
                          className="block text-[10.5px] text-muted-foreground"
                          title={client.lastLoginAt ? formatDateTime(client.lastLoginAt) : undefined}
                        >
                          {client.lastLoginAt
                            ? `Last login ${formatDateTimeShort(client.lastLoginAt)}`
                            : 'Never signed in'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={client.accountStatus} className={CELL_BADGE} />
                        <span className="mt-0.5 block text-[10.5px] font-medium">
                          {client.amount ? formatMoney(client.amount, client.currency) : '—'}
                        </span>
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
