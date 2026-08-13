'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { RefundRow, RefundStatus } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
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

const LABELS: Record<RefundStatus, string> = {
  requested: 'Requested',
  approved: 'Approve',
  rejected: 'Reject',
  processing: 'Mark processing',
  completed: 'Mark paid',
  failed: 'Mark failed',
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
  const [busy, setBusy] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);

  if (!canApprove || refund.allowedTransitions.length === 0) return null;

  const move = async (status: RefundStatus, body: Record<string, unknown> = {}) => {
    setBusy(true);

    try {
      await api.patch(`/api/v1/admin/refunds/${refund.id}`, { status, ...body });
      toast.success(`${refund.refundNumber} is now ${status}.`);
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
            {LABELS[status]}
          </Button>
        ))}
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <form onSubmit={onPay}>
            <DialogHeader>
              <DialogTitle>Record the refund</DialogTitle>
              <DialogDescription>
                {formatMoney(refund.amount, refund.currency)} back to {refund.customerName} for order{' '}
                {refund.orderNumber}. Do this once the money has actually gone.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <Field label="How it was refunded" htmlFor="method" hint="Cash, bank transfer, bKash, store credit…">
                <Input id="method" name="method" maxLength={40} defaultValue="cash" />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPayOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Mark as paid
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
