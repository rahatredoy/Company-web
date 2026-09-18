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
import { useT, type MessageKey } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
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

const REASONS: { value: string; label: MessageKey; needsEvidence: boolean }[] = [
  { value: 'damaged', label: 'Arrived damaged', needsEvidence: true },
  { value: 'wrong_item', label: 'Wrong item sent', needsEvidence: true },
  { value: 'not_as_described', label: 'Not as described', needsEvidence: true },
  { value: 'doesnt_fit', label: 'Does not fit', needsEvidence: false },
  { value: 'changed_mind', label: 'Changed my mind', needsEvidence: false },
  { value: 'other', label: 'Something else', needsEvidence: false },
];

const RESOLUTIONS: { value: string; label: MessageKey; description: MessageKey }[] = [
  { value: 'refund', label: 'Refund', description: 'Back to your original payment method in 5–7 working days.' },
  { value: 'exchange', label: 'Exchange', description: 'Swap for a different size or colour, subject to stock.' },
  { value: 'replacement', label: 'Replacement', description: 'The same item again. Best for a damaged delivery.' },
];

const STEPS = ['Items', 'Reason', 'Evidence', 'Review::step'] as const satisfies readonly MessageKey[];

/** Mirrors `RETURN_PHOTO_LIMITS` in client-api's `storefront/returns.routes.ts`. */
const MAX_PHOTOS = 2;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** The longest edge a photo is sent at. Plenty to see a scratch or a torn seam. */
const PHOTO_MAX_EDGE = 1600;

/**
 * A phone photo is often 4–8MB, and two of them would crowd the proxy's 10MB
 * body cap and a customer's mobile data alike. So a large one is redrawn at
 * `PHOTO_MAX_EDGE` as a JPEG before it is sent; a small one goes as it is. If
 * the browser cannot decode it, the original is kept and the API decides.
 */
async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= 1024 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

interface Selection {
  index: number;
  quantity: number;
}

export function ReturnWizard({ order, locale }: { order: OrderDetail; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [selected, setSelected] = React.useState<Map<number, Selection>>(new Map());
  const [reason, setReason] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [resolution, setResolution] = React.useState('refund');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // One object URL per file, revoked when the file leaves the list — creating
  // them in render would leak a URL on every keystroke elsewhere in the wizard.
  const previews = React.useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  React.useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const addPhotos = async (picked: File[]) => {
    const usable = picked.filter((file) => PHOTO_TYPES.has(file.type));
    if (usable.length < picked.length) {
      setError(t('That file is not a photo we can use. Choose a JPG, PNG or WebP.'));
    } else if (files.length + usable.length > MAX_PHOTOS) {
      setError(t('You can add up to 2 photos.'));
    } else {
      setError(null);
    }

    const room = MAX_PHOTOS - files.length;
    if (room <= 0) return;
    const shrunk = await Promise.all(usable.slice(0, room).map(shrinkPhoto));
    setFiles((current) => [...current, ...shrunk].slice(0, MAX_PHOTOS));
  };

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
    if (step === 0 && chosen.length === 0) return t('Choose at least one item to return.');
    if (step === 1 && !reason) return t('Tell us why you are returning it.');
    if (step === 1 && reason === 'other' && description.trim().length < 10) {
      return t('Please describe the problem in a sentence or two.');
    }
    if (step === 2 && evidenceRequired && files.length === 0) {
      return t('A photograph is needed for this reason — it is what lets us approve without waiting for the parcel.');
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
      // One request: the answers as JSON beside the photos, so a return is never
      // saved without the evidence it was submitted with.
      const form = new FormData();
      form.set(
        'payload',
        JSON.stringify({
          items: chosen.map((entry) => ({ lineIndex: entry.index, quantity: entry.quantity })),
          reason,
          description: description.trim() || null,
          resolution,
        }),
      );
      for (const file of files) form.append('photos', file, file.name);

      const response = await fetch(`/api/returns/${encodeURIComponent(order.orderNumber)}`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? t('We could not submit your return request.'));
        setSubmitting(false);
        return;
      }

      toast.success(t('Return requested'), {
        description: t('We will review it and email you within one working day.'),
      });
      router.push('/account/returns');
    } catch {
      setError(t('We could not reach the store. Please try again.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-8">
      {/* Progress. An ordered list, with the current step marked. */}
      <ol className="flex flex-wrap gap-2" aria-label={t('Return steps')}>
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
                {done ? <Check className="size-3.5" aria-hidden /> : <span>{t.number(index + 1)}</span>}
                {t(label)}
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
            <legend className="text-lg font-semibold">{t('Which items are you returning?')}</legend>

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
                        hint={t('{quantity} ordered · {price} each', {
                          quantity: line.quantity,
                          price: formatMoney(line.unitPrice, order.currency, locale),
                        })}
                      />
                    </div>

                    {entry ? (
                      <QuantityStepper
                        value={entry.quantity}
                        onChange={(quantity) => setQuantity(index, quantity)}
                        min={1}
                        max={line.quantity}
                        size="sm"
                        label={t('Quantity of {name} to return', { name: line.name })}
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
              <legend className="text-lg font-semibold">{t('Why are you returning it?')}</legend>
              <RadioGroup value={reason} onValueChange={setReason} className="mt-4" aria-label={t('Reason')}>
                {REASONS.map((entry) => (
                  <RadioCard
                    key={entry.value}
                    id={`reason-${entry.value}`}
                    value={entry.value}
                    title={t(entry.label)}
                    description={entry.needsEvidence ? t('A photograph will be needed') : undefined}
                    className="p-3"
                  />
                ))}
              </RadioGroup>
            </fieldset>

            <Field
              name="description"
              label={t('Anything else we should know?')}
              hint={reason === 'other' ? undefined : t('Optional')}
              required={reason === 'other'}
              className="mt-5"
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t('The more detail you give, the faster we can approve it.')}
                />
              )}
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-lg font-semibold">
              {t('Photographs')}{' '}
              {evidenceRequired ? '' : <span className="font-normal text-muted">{t('(optional)')}</span>}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {evidenceRequired
                ? t('A clear photograph of the problem lets us approve your return without waiting for the parcel to reach us.')
                : t('Not needed for this reason, but they can speed things up.')}
            </p>

            {files.length < MAX_PHOTOS ? (
              <label
                htmlFor="evidence"
                className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-(--radius-card) border border-dashed border-border-strong p-8 text-center transition-colors hover:border-primary"
              >
                <Upload className="size-6 text-subtle" aria-hidden />
                <span className="text-sm font-medium">{t('Choose photographs')}</span>
                <span className="text-xs text-subtle">{t('JPG, PNG or WebP · up to 2 photos')}</span>
                <input
                  id="evidence"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    // Cleared so picking the same photo again after removing it fires.
                    event.target.value = '';
                    void addPhotos(picked);
                  }}
                />
              </label>
            ) : null}

            {files.length > 0 ? (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="relative">
                    <span className="block aspect-square overflow-hidden rounded-(--radius-button) bg-surface-alt">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote asset */}
                      <img
                        src={previews[index]}
                        alt={t('Evidence {number}: {name}', { number: index + 1, name: file.name })}
                        className="size-full object-cover"
                      />
                    </span>

                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      aria-label={t('Remove {name}', { name: file.name })}
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
            <h2 className="text-lg font-semibold">{t('Review your request')}</h2>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium">{t('What would you like?')}</legend>
              <RadioGroup value={resolution} onValueChange={setResolution} aria-label={t('Resolution')}>
                {RESOLUTIONS.map((entry) => (
                  <RadioCard
                    key={entry.value}
                    id={`resolution-${entry.value}`}
                    value={entry.value}
                    title={t(entry.label)}
                    description={t(entry.description)}
                  />
                ))}
              </RadioGroup>
            </fieldset>

            <dl className="mt-6 space-y-2 border-t border-border pt-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t('Order')}</dt>
                <dd className="font-mono">{order.orderNumber}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t('Items')}</dt>
                <dd>{t.plural(itemCount, '{count} item', '{count} items')}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t('Reason')}</dt>
                <dd>{reasonMeta ? t(reasonMeta.label) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">{t('Photographs')}</dt>
                <dd>{t.number(files.length)}</dd>
              </div>
            </dl>

            <p className="mt-5 text-xs text-subtle">
              {t(
                'We review returns within one working day and email you what happens next, including how to send the items back.',
              )}
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
            {t('Back')}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              {t('Continue')}
              <ChevronRight aria-hidden />
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={submitting}>
              {submitting ? <Spinner /> : null}
              {t('Submit request')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
