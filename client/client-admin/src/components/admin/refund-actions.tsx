'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { RefundRow, RefundStatus } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

const LABELS: Record<RefundStatus, MessageKey> = {
  requested: 'Requested',
  approved: 'Approve',
  rejected: 'Reject',
  processing: 'Mark processing',
  completed: 'Mark paid',
  failed: 'Mark failed',
};

/** A status as it reads in the middle of a sentence, lower case in English. */
const STATUS_WORD: Record<RefundStatus, MessageKey> = {
  requested: 'requested::status',
  approved: 'approved::status',
  rejected: 'rejected::status',
  processing: 'processing::status',
  completed: 'completed::status',
  failed: 'failed::status',
};

/**
 * Approving and settling a refund.
 *
 * "Mark paid" is a record of something that happened outside this system — the
 * platform settles cash on delivery and a test gateway, so there is nothing to
 * call. It asks how the money went back, because that is the only trace the shop
 * will have, and it is the step that moves `orders.refunded_total` and closes
 * off any further refund against that order.
 */
export function RefundActions({ refund, canApprove }: { refund: RefundRow; canApprove: boolean }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);

  if (!canApprove || refund.allowedTransitions.length === 0) return null;

  const move = async (status: RefundStatus, body: Record<string, unknown> = {}) => {
    setBusy(true);

    try {
      await api.patch(`/api/v1/admin/refunds/${refund.id}`, { status, ...body });
      toast.success(t('{number} is now {status}.', { number: refund.refundNumber, status: t(STATUS_WORD[status]) }));
      setPayOpen(false);
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const onPay = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void move('completed', {
      method: String(data.get('method') ?? '').trim() || 'manual',
    });
  };

  return (
    <>
      <div className="flex justify-end gap-2">
        {refund.allowedTransitions.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={status === 'rejected' || status === 'failed' ? 'ghost' : status === 'completed' ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => {
              if (status === 'completed') setPayOpen(true);
              else void move(status);
            }}
          >
            {t(LABELS[status])}
          </Button>
        ))}
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <form onSubmit={onPay}>
            <DialogHeader>
              <DialogTitle>{t('Record the refund')}</DialogTitle>
              <DialogDescription>
                {t('{amount} back to {customer} for order {order}. Do this once the money has actually gone.', {
                  amount: t.money(refund.amount, refund.currency),
                  customer: refund.customerName,
                  order: refund.orderNumber,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <Field
                label={t('How it was refunded')}
                htmlFor="method"
                hint={t('Cash, bank transfer, bKash, store credit…')}
              >
                <Input id="method" name="method" maxLength={40} defaultValue="cash" />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPayOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" loading={busy}>
                {t('Mark as paid')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
