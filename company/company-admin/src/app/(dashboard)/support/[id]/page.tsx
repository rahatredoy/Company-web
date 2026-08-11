import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TicketPanel } from '@/components/admin/ticket-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { serverGetOptional } from '@/lib/server-api';
import { formatDateTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SupportMessage, SupportTicketRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Ticket' };

interface TicketDetail extends SupportTicketRow {
  messages: SupportMessage[];
}

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await serverGetOptional<TicketDetail>(`/api/v1/admin/support/${id}`);
  if (!ticket) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/support">
          <ArrowLeft /> All tickets
        </Link>
      </Button>

      <PageHeader
        title={ticket.subject}
        description={`${ticket.reference} · opened ${formatDateTime(ticket.createdAt)}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/clients/${ticket.clientId}`}>{ticket.businessName}</Link>
            </Button>
            <Badge
              variant={
                ticket.priority === 'urgent' ? 'danger' : ticket.priority === 'high' ? 'warning' : 'neutral'
              }
            >
              {titleCase(ticket.priority)} priority
            </Badge>
            <StatusBadge status={ticket.status} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          {ticket.messages.map((message) => {
            const fromAdmin = message.authorType === 'admin';
            return (
              <Card key={message.id} className={cn(fromAdmin && 'border-primary/25 bg-primary-soft/40')}>
                <CardContent className="space-y-2 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {message.authorName}
                      {fromAdmin ? (
                        <Badge variant="primary" className="ml-2">
                          Support team
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</p>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{message.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardContent className="p-5">
            <TicketPanel ticketId={ticket.id} status={ticket.status} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
