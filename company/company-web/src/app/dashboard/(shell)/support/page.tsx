import type { Metadata } from 'next';
import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { NewTicketDialog } from '@/components/dashboard/new-ticket-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { serverGetPaginated } from '@/lib/server-api';
import { formatRelative, titleCase } from '@/lib/format';
import type { SupportTicketView } from '@/lib/types';

export const metadata: Metadata = { title: 'Support', robots: { index: false, follow: false } };

export default async function SupportPage() {
  const { data: tickets } = await serverGetPaginated<SupportTicketView>('/api/v1/client/support').catch(
    () => ({ data: [] as SupportTicketView[], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  );

  return (
    <>
      <PageHeader
        title="Support"
        description="Ask a question or report a problem — we reply by email too."
        actions={<NewTicketDialog />}
      />

      {tickets.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="No tickets yet"
          description="When you open a ticket it appears here with every reply from our team."
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Replies</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{ticket.reference}</TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/support/${ticket.id}`}
                          className="font-medium text-primary hover:underline"
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
                      <TableCell>{ticket.messageCount}</TableCell>
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
    </>
  );
}
