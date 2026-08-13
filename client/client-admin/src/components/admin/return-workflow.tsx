'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ReturnDetail, ReturnStatus } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

const LABELS: Record<ReturnStatus, string> = {
  requested: 'Requested',
  under_review: 'Start review',
  approved: 'Approve',
  rejected: 'Reject',
  received: 'Mark received',
  inspected: 'Record inspection',
  completed: 'Complete and refund',
};

/**
 * Working a return through to a refund.
 *
 * Two steps ask for more than a click. **Rejecting** wants a reason, because the
 * customer is told it and "no" on its own is what generates the next support
 * message. **Inspecting** wants a per-item count of what came back sellable —
 * restocking the whole return automatically is how a shop ends up re-selling
 * something that was returned broken, so the default here is zero and somebody
 * has to say otherwise.
 */
export function ReturnWorkflow({
  detail,
  canApprove,
}: {
  detail: ReturnDetail;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<ReturnStatus | null>(null);
  const [error, setError] = React.useState('');
  const [prompt, setPrompt] = React.useState<ReturnStatus | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (!canApprove) return null;

  const move = async (status: ReturnStatus, body: Record<string, unknown> = {}) => {
    setBusy(status);
    setError('');

    try {
      const result = await api.patch<{ refundNumber: string | null }>(
        `/api/v1/admin/returns/${detail.id}/status`,
        { status, ...body },
      );

      toast.success(
        result?.refundNumber
          ? `Return completed. Refund ${result.refundNumber} is waiting for approval.`
          : `Return is now ${status.replace(/_/g, ' ')}.`,
      );
      setPrompt(null);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
      setSaving(false);
    }
  };

  const onPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt || saving) return;

    const data = new FormData(event.currentTarget);
    setSaving(true);

    if (prompt === 'rejected') {
      await move('rejected', { rejectionReason: String(data.get('rejectionReason') ?? '').trim() });
      return;
    }

    const restock = detail.items.map((item) => ({
      itemId: item.id,
      quantity: Math.max(0, Math.min(item.quantity, Number(data.get(`restock-${item.id}`) ?? 0))),
    }));

    await move('inspected', { restock, note: String(data.get('note') ?? '').trim() || undefined });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>What happens next</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {detail.allowedTransitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">This return is finished.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.allowedTransitions.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={status === 'rejected' ? 'outline' : 'primary'}
                disabled={busy !== null}
                loading={busy === status}
                onClick={() => {
                  if (status === 'rejected' || status === 'inspected') setPrompt(status);
                  else void move(status);
                }}
              >
                {LABELS[status]}
              </Button>
            ))}
          </div>
        )}

        {detail.resolution === 'refund' && detail.allowedTransitions.includes('completed') ? (
          <p className="text-xs text-muted-foreground">
            Completing raises a refund for review. It is not paid until someone approves it under
            Refunds.
          </p>
        ) : null}
      </CardContent>

      <Dialog open={prompt !== null} onOpenChange={(open) => !open && setPrompt(null)}>
        <DialogContent>
          <form onSubmit={onPrompt}>
            <DialogHeader>
              <DialogTitle>{prompt === 'rejected' ? 'Reject this return' : 'Record the inspection'}</DialogTitle>
              <DialogDescription>
                {prompt === 'rejected'
                  ? 'The customer is shown this, so say what went wrong.'
                  : 'How many of each item came back in a sellable state? Anything you leave at zero is written off as damaged.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {prompt === 'rejected' ? (
                <Field label="Reason" htmlFor="rejectionReason" required>
                  <Textarea id="rejectionReason" name="rejectionReason" rows={3} maxLength={300} />
                </Field>
              ) : (
                <>
                  {detail.items.map((item) => (
                    <Field
                      key={item.id}
                      label={`${item.productName} — ${item.quantity} returned`}
                      htmlFor={`restock-${item.id}`}
                    >
                      <Input
                        id={`restock-${item.id}`}
                        name={`restock-${item.id}`}
                        type="number"
                        min={0}
                        max={item.quantity}
                        defaultValue={0}
                      />
                    </Field>
                  ))}
                  <Field label="Note" htmlFor="note">
                    <Input id="note" name="note" maxLength={300} />
                  </Field>
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPrompt(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} variant={prompt === 'rejected' ? 'destructive' : 'primary'}>
                {prompt === 'rejected' ? 'Reject return' : 'Save inspection'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
