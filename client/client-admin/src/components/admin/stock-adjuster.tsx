'use client';

import * as React from 'react';
import { Minus, Plus, TriangleAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetBody,
  SheetColumn,
  SheetColumns,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/components/ui/toaster';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InventoryBucket, InventoryRow } from '@/lib/types';
import { SELECT_CLASS } from './category-tree';

/**
 * Adjusting one stock level.
 *
 * The amount is a **signed delta**, not a new total, and that is deliberate: two
 * people counting the same shelf both submit "+12 found" and both are right,
 * whereas both submitting "now 40" means one of them silently loses. The API
 * applies it as a single conditional `UPDATE` for the same reason, and the
 * database refuses anything that would drive a bucket negative — which is what
 * turns a race for the last unit into a refusal rather than an oversell.
 *
 * The warning line is saved through a **different endpoint**, because it is not a
 * quantity: nothing moves, so there is nothing for the ledger to record. Changing
 * it alone would otherwise need an invented +1/−1 and would write two false
 * movements into the history that exists to explain the count.
 */

const BUCKETS: { value: InventoryBucket; label: string; hint: string }[] = [
  { value: 'available', label: 'Available', hint: 'Sellable right now' },
  { value: 'damaged', label: 'Damaged', hint: 'Held back, never sold' },
  { value: 'incoming', label: 'Incoming', hint: 'On order, not yet received' },
];

/** Common counting corrections, so the usual case is one tap. */
const QUICK = [-10, -5, -1, 1, 5, 10];

export function StockAdjuster({
  row,
  open,
  onOpenChange,
  onSaved,
}: {
  row: InventoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [bucket, setBucket] = React.useState<InventoryBucket>('available');
  const [delta, setDelta] = React.useState('0');
  const [reason, setReason] = React.useState('');
  const [threshold, setThreshold] = React.useState('0');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const identity = `${open ? 'open' : 'shut'}:${row?.id ?? 'none'}`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setBucket('available');
    setDelta('0');
    setReason('');
    setThreshold(String(row?.lowStockThreshold ?? 0));
    setError('');
    setFieldErrors({});
  }

  const amount = Number(delta) || 0;
  const thresholdChanged = row !== null && Number(threshold) !== row.lowStockThreshold;
  const nothingToDo = amount === 0 && !thresholdChanged;

  /** What the chosen bucket holds now, so the preview is about the right number. */
  const currentOf = (which: InventoryBucket) => {
    if (!row) return 0;
    return which === 'available'
      ? row.available
      : which === 'damaged'
        ? row.damaged
        : which === 'incoming'
          ? row.incoming
          : which === 'reserved'
            ? row.reserved
            : row.returnPending;
  };

  const after = currentOf(bucket) + amount;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || nothingToDo) return;

    setBusy(true);
    setError('');
    setFieldErrors({});

    try {
      if (amount !== 0) {
        // The threshold rides along with a real movement — one request, one ledger
        // row, and the two can never be half-applied.
        await api.post('/api/v1/admin/inventory/adjust', {
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          bucket,
          delta: amount,
          reason: reason.trim() || undefined,
          ...(thresholdChanged ? { lowStockThreshold: Number(threshold) || 0 } : {}),
        });
      } else {
        await api.patch('/api/v1/admin/inventory/threshold', {
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          lowStockThreshold: Number(threshold) || 0,
        });
      }

      toast.success(
        amount === 0
          ? 'Warning line saved.'
          : `${row.productName}: ${amount > 0 ? '+' : ''}${formatNumber(amount)} ${bucket.replace('_', ' ')}.`,
      );
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {row ? (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <SheetHeader>
              <SheetTitle>Adjust Stock</SheetTitle>
              <SheetDescription>
                {[row.productName, row.variantTitle, row.sku].filter(Boolean).join(' · ')} · {row.warehouseName}
              </SheetDescription>
            </SheetHeader>

            <SheetBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* What is there and what is being moved on the left; what it
                  leaves behind and why, on the right — so the counts stay in
                  sight of the number being typed against them. */}
              <SheetColumns>
                <SheetColumn>
                  {/* ---------------------------------------------- what is there */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
                    <Count label="Available" value={row.available} strong />
                    <Count label="Reserved" value={row.reserved} />
                    <Count label="Incoming" value={row.incoming} />
                    <Count label="Damaged" value={row.damaged} />
                    <Count label="Returns" value={row.returnPending} />
                    <Count label="Warn at" value={row.lowStockThreshold} />
                  </div>

                  <p className="-mt-2 text-xs text-muted-foreground">
                    Reserved units are committed to orders that have not shipped, and are already out of Available.
                  </p>

                  <Field label="Which count" htmlFor="stock-bucket">
                    <select
                      id="stock-bucket"
                      value={bucket}
                      onChange={(event) => setBucket(event.target.value as InventoryBucket)}
                      className={SELECT_CLASS}
                    >
                      {BUCKETS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.hint}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Change by"
                    htmlFor="stock-delta"
                    hint="Positive adds, negative removes. 12 received, or −3 broken."
                    error={fieldErrors.delta}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setDelta(String(amount - 1))}
                          aria-label="One less"
                        >
                          <Minus />
                        </Button>
                        <Input
                          id="stock-delta"
                          type="number"
                          step={1}
                          value={delta}
                          onChange={(event) => setDelta(event.target.value)}
                          className="text-center tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setDelta(String(amount + 1))}
                          aria-label="One more"
                        >
                          <Plus />
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {QUICK.map((step) => (
                          <Button
                            key={step}
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDelta(String(amount + step))}
                          >
                            {step > 0 ? `+${step}` : step}
                          </Button>
                        ))}
                        {amount !== 0 ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDelta('0')}>
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </Field>
                </SheetColumn>

                <SheetColumn>
                  {amount !== 0 ? (
                    <div
                      className={cn(
                        'flex items-center justify-between rounded-lg border p-3 text-sm',
                        after < 0 ? 'border-destructive/40 bg-destructive-soft' : 'border-border bg-muted/50',
                      )}
                    >
                      <span className="text-muted-foreground">
                        {BUCKETS.find((option) => option.value === bucket)?.label ?? bucket} after this
                      </span>
                      <span className="font-semibold tabular-nums">{formatNumber(after)}</span>
                    </div>
                  ) : null}

                  {after < 0 ? (
                    <Alert variant="danger">
                      There is not that much to remove — the database refuses a count below zero, so this will be
                      rejected rather than clamped.
                    </Alert>
                  ) : null}

                  <Field
                    label="Why"
                    htmlFor="stock-reason"
                    hint="Kept in the stock ledger, next to who did it."
                    error={fieldErrors.reason}
                  >
                    <Input
                      id="stock-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={300}
                      placeholder="Stock count, delivery, breakage…"
                    />
                  </Field>

                  <Field
                    label="Low-stock warning at"
                    htmlFor="stock-threshold"
                    hint="At or below this the row is flagged, and the storefront says “only a few left”."
                    error={fieldErrors.lowStockThreshold}
                  >
                    <Input
                      id="stock-threshold"
                      type="number"
                      min={0}
                      max={100_000}
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                      className="w-32 tabular-nums"
                    />
                  </Field>

                  {thresholdChanged && amount === 0 ? (
                    <p className="-mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                      Saving only moves the warning line. No stock moves, so nothing is written to the ledger.
                    </p>
                  ) : null}
                </SheetColumn>
              </SheetColumns>
            </SheetBody>

            <SheetFooter>
              <Badge variant="neutral" className="mr-auto">
                {row.warehouseName}
              </Badge>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={nothingToDo}>
                {amount === 0 ? 'Save warning line' : 'Apply change'}
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-base font-semibold' : 'text-sm')}>{formatNumber(value)}</p>
    </div>
  );
}
