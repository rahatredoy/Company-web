'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useT, type MessageKey } from '@/lib/i18n';

/**
 * Cancel an order.
 *
 * A confirmation dialog, because it is irreversible — the design brief lists
 * order cancellation among the actions that must not happen on a single click.
 * The reason is required: it is the only signal the shop gets about why orders
 * are being cancelled, and "other" with a free-text box is where the useful
 * answers live.
 */

const REASONS: { value: string; label: MessageKey }[] = [
  { value: 'changed_mind', label: 'I changed my mind' },
  { value: 'found_cheaper', label: 'Found it cheaper elsewhere' },
  { value: 'ordered_by_mistake', label: 'Ordered by mistake' },
  { value: 'too_slow', label: 'Delivery is taking too long' },
  { value: 'other', label: 'Something else' },
];

export function CancelOrderDialog({ orderNumber }: { orderNumber: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onConfirm = async () => {
    if (!reason) {
      setError(t('Please choose a reason.'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, notes: notes.trim() || null }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? t('We could not cancel this order.'));
        setSubmitting(false);
        return;
      }

      setOpen(false);
      toast.success(t('Order {orderNumber} cancelled', { orderNumber }), {
        description: t('Any payment taken will be refunded within a few working days.'),
      });
      router.refresh();
    } catch {
      setError(t('We could not reach the store. Please try again.'));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-error hover:bg-error/8">
          <XCircle aria-hidden />
          {t('Cancel order')}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Cancel order {orderNumber}?', { orderNumber })}</DialogTitle>
          <DialogDescription>
            {t(
              'This cannot be undone. Anything already paid is refunded to the original payment method within a few working days.',
            )}
          </DialogDescription>
        </DialogHeader>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('Why are you cancelling?')}</legend>
          <RadioGroup value={reason} onValueChange={setReason} aria-label={t('Cancellation reason')}>
            {REASONS.map((item) => (
              <RadioCard
                key={item.value}
                id={`cancel-${item.value}`}
                value={item.value}
                title={t(item.label)}
                className="p-3"
              />
            ))}
          </RadioGroup>
        </fieldset>

        {reason === 'other' ? (
          <Field name="cancel-notes" label={t('Tell us more')} className="mt-4">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('Keep my order')}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={submitting}>
            {submitting ? <Spinner /> : null}
            {t('Cancel order')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
