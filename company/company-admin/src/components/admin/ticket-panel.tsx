'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Send, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import type { SupportTicketStatus } from '@/lib/types';

export function TicketPanel({
  ticketId,
  status,
}: {
  ticketId: string;
  status: SupportTicketStatus;
}) {
  const router = useRouter();
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (message.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/admin/support/${ticketId}/reply`, { message: message.trim() });
      setMessage('');
      toast.success('Reply sent');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (next: SupportTicketStatus) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/admin/support/${ticketId}/status`, { status: next });
      toast.success(`Ticket marked ${next.replace('_', ' ')}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <form onSubmit={reply} className="space-y-3">
        <Field label="Reply to client" htmlFor="reply">
          <Textarea
            id="reply"
            rows={5}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Write your reply…"
            disabled={status === 'closed'}
          />
        </Field>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStatus('resolved')}
              disabled={busy || status === 'resolved' || status === 'closed'}
            >
              <CheckCircle2 /> Mark resolved
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStatus('closed')}
              disabled={busy || status === 'closed'}
            >
              <XCircle /> Close ticket
            </Button>
          </div>
          <Button type="submit" loading={busy} disabled={status === 'closed' || !message.trim()}>
            <Send /> Send reply
          </Button>
        </div>
      </form>
    </div>
  );
}
