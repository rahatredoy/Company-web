'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ReturnStatus } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useT, type MessageKey } from '@/lib/i18n';

const LABELS: Record<ReturnStatus, MessageKey> = {
  requested: 'Requested',
  under_review: 'Start review',
  approved: 'Approve',
  rejected: 'Reject',
  received: 'Mark received',
  inspected: 'Record inspection',
  completed: 'Complete and refund',
};

/** A status as it reads in the middle of a sentence, lower case in English. */
const STATUS_WORD: Record<ReturnStatus, MessageKey> = {
  requested: 'requested::status',
  under_review: 'under review::status',
  approved: 'approved::status',
  rejected: 'rejected::status',
  received: 'received::status',
  inspected: 'inspected::status',
  completed: 'completed::status',
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
 *
 * It lives in the footer of the return's View panel — a return has no screen of
 * its own — so a move re-reads the panel (`onMoved`) as well as the list behind
 * it, and the next buttons are the new status's.
 */
export interface ReturnWorkflowRecord {
  id: string;
  resolution: string;
  items: { id: string; productName: string; quantity: number }[];
  allowedTransitions: ReturnStatus[];
}

export function ReturnWorkflow({
  detail,
  canApprove,
  onMoved,
}: {
  detail: ReturnWorkflowRecord;
  canApprove: boolean;
  onMoved?: () => void;
}) {
  const router = useRouter();
  const t = useT();
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
          ? t('Return completed. Refund {number} is waiting for approval.', { number: result.refundNumber })
          : t('Return is now {status}.', { status: t(STATUS_WORD[status]) }),
      );
      setPrompt(null);
      onMoved?.();
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
    <div className="w-full space-y-2">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {detail.allowedTransitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('This return is finished.')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {detail.allowedTransitions.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={status === 'rejected' ? 'outline' : 'primary'}
              className={status === 'rejected' ? 'text-destructive' : undefined}
              disabled={busy !== null}
              loading={busy === status}
              onClick={() => {
                if (status === 'rejected' || status === 'inspected') setPrompt(status);
                else void move(status);
              }}
            >
              {t(LABELS[status])}
            </Button>
          ))}
        </div>
      )}

      {detail.resolution === 'refund' && detail.allowedTransitions.includes('completed') ? (
        <p className="text-xs text-muted-foreground">
          {t('Completing raises a refund for review. It is not paid until someone approves it under Refunds.')}
        </p>
      ) : null}

      <Dialog open={prompt !== null} onOpenChange={(open) => !open && setPrompt(null)}>
        <DialogContent size={prompt === 'rejected' ? 'sm' : 'md'}>
          <form onSubmit={onPrompt}>
            <DialogHeader>
              <DialogTitle>{prompt === 'rejected' ? t('Reject this return') : t('Record the inspection')}</DialogTitle>
              <DialogDescription>
                {prompt === 'rejected'
                  ? t('The customer is shown this, so say what went wrong.')
                  : t(
                      'How many of each item came back in a sellable state? Anything you leave at zero is written off as damaged.',
                    )}
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              {prompt === 'rejected' ? (
                <Field label={t('Reason')} htmlFor="rejectionReason" required>
                  <Textarea id="rejectionReason" name="rejectionReason" rows={3} maxLength={300} />
                </Field>
              ) : (
                <>
                  {/* One count per returned line, two to a row: a return of six
                      items stacked is six rows of dialog, and the count boxes
                      are narrow enough that the height buys nothing. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {detail.items.map((item) => (
                      <Field
                        key={item.id}
                        label={t('{product} — {count} returned', { product: item.productName, count: item.quantity })}
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
                  </div>
                  <Field label={t('Note')} htmlFor="note">
                    <Input id="note" name="note" maxLength={300} />
                  </Field>
                </>
              )}
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPrompt(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" loading={saving} variant={prompt === 'rejected' ? 'destructive' : 'primary'}>
                {prompt === 'rejected' ? t('Reject return') : t('Save inspection')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
