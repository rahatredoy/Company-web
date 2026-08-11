'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDetail } from '@/types';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { formatMoney, pluralise } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * The return request wizard.
 *
 * Four steps: what, why, evidence, review. Split up because a single form
 * asking all of it at once is intimidating on the one screen where the customer
 * is already unhappy — and because each step's answer changes what the next one
 * needs to ask.
 *
 * Evidence is only *required* for damage and wrong-item claims, where a
 * photograph is what lets the shop approve without shipping the item back
 * first. Demanding one for "it does not fit" is friction with no purpose.
 */

const REASONS = [
  { value: 'damaged', label: 'Arrived damaged', needsEvidence: true },
  { value: 'wrong_item', label: 'Wrong item sent', needsEvidence: true },
  { value: 'not_as_described', label: 'Not as described', needsEvidence: true },
  { value: 'doesnt_fit', label: 'Does not fit', needsEvidence: false },
  { value: 'changed_mind', label: 'Changed my mind', needsEvidence: false },
  { value: 'other', label: 'Something else', needsEvidence: false },
];

const RESOLUTIONS = [
  { value: 'refund', label: 'Refund', description: 'Back to your original payment method in 5–7 working days.' },
  { value: 'exchange', label: 'Exchange', description: 'Swap for a different size or colour, subject to stock.' },
  { value: 'replacement', label: 'Replacement', description: 'The same item again. Best for a damaged delivery.' },
];

const STEPS = ['Items', 'Reason', 'Evidence', 'Review'] as const;

interface Selection {
  index: number;
  quantity: number;
}

export function ReturnWizard({ order, locale }: { order: OrderDetail; locale: string }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [selected, setSelected] = React.useState<Map<number, Selection>>(new Map());
  const [reason, setReason] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [resolution, setResolution] = React.useState('refund');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reasonMeta = REASONS.find((entry) => entry.value === reason);
  const evidenceRequired = reasonMeta?.needsEvidence ?? false;

  const chosen = [...selected.values()].sort((a, b) => a.index - b.index);
  const itemCount = chosen.reduce((sum, entry) => sum + entry.quantity, 0);

  const toggleItem = (index: number) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(index)) next.delete(index);
      else next.set(index, { index, quantity: 1 });
      return next;
    });
  };

  const setQuantity = (index: number, quantity: number) => {
    setSelected((current) => {
      const next = new Map(current);
      const entry = next.get(index);
      if (entry) next.set(index, { ...entry, quantity });
      return next;
    });
  };

  /** Which step the visitor may advance to, and why not. */
  const blocker = (): string | null => {
    if (step === 0 && chosen.length === 0) return 'Choose at least one item to return.';
    if (step === 1 && !reason) return 'Tell us why you are returning it.';
    if (step === 1 && reason === 'other' && description.trim().length < 10) {
      return 'Please describe the problem in a sentence or two.';
    }
    if (step === 2 && evidenceRequired && files.length === 0) {
      return 'A photograph is needed for this reason — it is what lets us approve without waiting for the parcel.';
    }
    return null;
  };

  const next = () => {
    const problem = blocker();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  };

  const back = () => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/returns/${encodeURIComponent(order.orderNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chosen.map((entry) => ({ lineIndex: entry.index, quantity: entry.quantity })),
          reason,
          description: description.trim() || null,
          resolution,
          // File contents are uploaded separately in the real flow; the request
          // records how many were attached so the API can expect them.
          evidenceCount: files.length,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'We could not submit your return request.');
        setSubmitting(false);
        return;
      }

      toast.success('Return requested', {
        description: 'We will review it and email you within one working day.',
      });
      router.push('/account/returns');
    } catch {
      setError('We could not reach the store. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-8">
      {/* Progress. An ordered list, with the current step marked. */}
      <ol className="flex flex-wrap gap-2" aria-label="Return steps">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;

          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-(--radius-pill) px-3 py-1.5 text-xs font-medium',
                  current
                    ? 'bg-primary text-primary-foreground'
                    : done
                      ? 'bg-primary-soft text-primary'
                      : 'bg-surface-alt text-subtle',
                )}
                aria-current={current ? 'step' : undefined}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : <span>{index + 1}</span>}
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <ChevronRight className="size-3.5 text-subtle" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-(--radius-card) border border-border bg-surface p-5 sm:p-6">
        {step === 0 ? (
          <fieldset>
            <legend className="text-lg font-semibold">Which items are you returning?</legend>

            <ul className="mt-4 divide-y divide-border">
              {order.lines.map((line, index) => {
                const entry = selected.get(index);

                return (
                  <li key={index} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-(--radius-button) bg-surface-alt">
                      {line.imageUrl ? (
                        <Image src={line.imageUrl} alt="" aria-hidden fill sizes="56px" className="object-cover" />
                      ) : null}
                    </span>

                    <div className="min-w-0 flex-1">
                      <CheckboxField
                        id={`return-item-${index}`}
                        checked={Boolean(entry)}
                        onCheckedChange={() => toggleItem(index)}
                        label={line.name}
                        hint={`${line.quantity} ordered · ${formatMoney(line.unitPrice, order.currency, locale)} each`}
                      />
                    </div>

                    {entry ? (
                      <QuantityStepper
                        value={entry.quantity}
                        onChange={(quantity) => setQuantity(index, quantity)}
                        min={1}
                        max={line.quantity}
                        size="sm"
                        label={`Quantity of ${line.name} to return`}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {step === 1 ? (
          <>
            <fieldset>
              <legend className="text-lg font-semibold">Why are you returning it?</legend>
              <RadioGroup value={reason} onValueChange={setReason} className="mt-4" aria-label="Reason">
                {REASONS.map((entry) => (
                  <RadioCard
                    key={entry.value}
                    id={`reason-${entry.value}`}
                    value={entry.value}
                    title={entry.label}
                    description={entry.needsEvidence ? 'A photograph will be needed' : undefined}
                    className="p-3"
                  />
                ))}
              </RadioGroup>
            </fieldset>

            <Field
              name="description"
              label="Anything else we should know?"
              hint={reason === 'other' ? undefined : 'Optional'}
              required={reason === 'other'}
              className="mt-5"
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="The more detail you give, the faster we can approve it."
                />
              )}
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-lg font-semibold">
              Photographs {evidenceRequired ? '' : <span className="font-normal text-muted">(optional)</span>}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {evidenceRequired
                ? 'A clear photograph of the problem lets us approve your return without waiting for the parcel to reach us.'
                : 'Not needed for this reason, but they can speed things up.'}
            </p>

            <label
              htmlFor="evidence"
              className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-(--radius-card) border border-dashed border-border-strong p-8 text-center transition-colors hover:border-primary"
            >
              <Upload className="size-6 text-subtle" aria-hidden />
              <span className="text-sm font-medium">Choose photographs</span>
              <span className="text-xs text-subtle">JPG or PNG, up to 5 MB each, 4 maximum</span>
              <input
                id="evidence"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  // Bounded client-side for a fast message; the API enforces it.
                  const valid = picked.filter((file) => file.size <= 5 * 1024 * 1024);
                  if (valid.length < picked.length) {
                    setError('Some files were over 5 MB and were skipped.');
                  }
                  setFiles((current) => [...current, ...valid].slice(0, 4));
                }}
              />
            </label>

            {files.length > 0 ? (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="relative">
                    <span className="block aspect-square overflow-hidden rounded-(--radius-button) bg-surface-alt">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote asset */}
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Evidence ${index + 1}: ${file.name}`}
                        className="size-full object-cover"
                      />
                    </span>

                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      aria-label={`Remove ${file.name}`}
                      className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-surface text-muted shadow-[var(--shadow-card)] hover:text-error"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-lg font-semibold">Review your request</h2>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium">What would you like?</legend>
              <RadioGroup value={resolution} onValueChange={setResolution} aria-label="Resolution">
                {RESOLUTIONS.map((entry) => (
                  <RadioCard
                    key={entry.value}
                    id={`resolution-${entry.value}`}
                    value={entry.value}
                    title={entry.label}
                    description={entry.description}
                  />
                ))}
              </RadioGroup>
            </fieldset>

            <dl className="mt-6 space-y-2 border-t border-border pt-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Order</dt>
                <dd className="font-mono">{order.orderNumber}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Items</dt>
                <dd>
                  {itemCount} {pluralise(itemCount, 'item')}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Reason</dt>
                <dd>{reasonMeta?.label ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Photographs</dt>
                <dd>{files.length}</dd>
              </div>
            </dl>

            <p className="mt-5 text-xs text-subtle">
              We review returns within one working day and email you what happens next, including
              how to send the items back.
            </p>
          </>
        ) : null}

        {error ? (
          <Alert tone="warning" className="mt-5">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="ghost" onClick={back} disabled={step === 0 || submitting}>
            <ChevronLeft aria-hidden />
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              Continue
              <ChevronRight aria-hidden />
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={submitting}>
              {submitting ? <Spinner /> : null}
              Submit request
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
