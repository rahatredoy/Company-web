import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LifeBuoy } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import type { SupportTicketRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Support' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: tickets, meta, unavailable } = await listOrEmpty<SupportTicketRow>(
    '/api/v1/admin/support',
    params,
  );

  return (
    <>
      <PageHeader title="Support" description="Tickets raised by clients from their account area." />

      {unavailable ? <ApiUnavailable resource="The ticket list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters
          searchPlaceholder="Search ticket reference, subject or business…"
          statusOptions={STATUS_FILTERS}
        />
      </Suspense>

      {tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No tickets found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket ID</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last reply</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <code className="font-mono text-xs text-muted-foreground">{ticket.reference}</code>
                      </TableCell>
                      <TableCell>
                        <Link href={`/clients/${ticket.clientId}`} className="font-medium hover:text-primary">
                          {ticket.businessName}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-72">
                        <Link
                          href={`/support/${ticket.id}`}
                          className="block truncate font-medium text-primary hover:underline"
                        >
                          {ticket.subject}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ticket.priority === 'urgent'
                              ? 'danger'
                              : ticket.priority === 'high'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {titleCase(ticket.priority)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={ticket.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(ticket.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatRelative(ticket.lastReplyAt ?? ticket.createdAt)}
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
