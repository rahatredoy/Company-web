'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { InventoryBucket, InventoryRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
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

const BUCKETS: { value: InventoryBucket; label: string; hint: string }[] = [
  { value: 'available', label: 'Available', hint: 'Sellable right now.' },
  { value: 'damaged', label: 'Damaged', hint: 'Held back, never sold.' },
  { value: 'incoming', label: 'Incoming', hint: 'On a purchase order, not yet received.' },
];

/**
 * Adjusting a stock level.
 *
 * The amount is a **signed delta**, not a new total, and that is deliberate: two
 * people counting the same shelf at the same time both submit "+12 found" and
 * both are right, whereas both submitting "now 40" means one of them silently
 * loses. The API applies it as a single conditional `UPDATE` for the same
 * reason, and the database refuses anything that would drive a bucket negative.
 */
export function StockAdjuster({ row, canAdjust }: { row: InventoryRow; canAdjust: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  if (!canAdjust) return null;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const delta = Number(data.get('delta'));

    if (!Number.isFinite(delta) || delta === 0) {
      setFieldErrors({ delta: 'Enter an amount, positive or negative.' });
      return;
    }

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      await api.post('/api/v1/admin/inventory/adjust', {
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        bucket: String(data.get('bucket') ?? 'available'),
        delta,
        reason: String(data.get('reason') ?? '').trim() || undefined,
        lowStockThreshold: Number(data.get('lowStockThreshold')),
      });

      setOpen(false);
      toast.success(`${row.productName} updated.`);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? '']),
          ),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Adjust
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Adjust stock</DialogTitle>
              <DialogDescription>
                {row.productName}
                {row.variantTitle ? ` · ${row.variantTitle}` : ''} · {row.sku} ·{' '}
                {row.warehouseName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Available now</span>
                  <span className="font-medium tabular-nums">{row.available}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reserved for orders</span>
                  <span className="tabular-nums">{row.reserved}</span>
                </div>
              </div>

              <Field label="Bucket" htmlFor="bucket">
                <select
                  id="bucket"
                  name="bucket"
                  defaultValue="available"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {BUCKETS.map((bucket) => (
                    <option key={bucket.value} value={bucket.value}>
                      {bucket.label} — {bucket.hint}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Change by"
                htmlFor="delta"
                required
                error={fieldErrors.delta}
                hint="Positive adds, negative removes. 12 received, or −3 broken."
              >
                <Input id="delta" name="delta" type="number" step={1} defaultValue={0} />
              </Field>

              <Field
                label="Low-stock warning at"
                htmlFor="lowStockThreshold"
                hint="Below this, the storefront shows “only a few left”."
              >
                <Input
                  id="lowStockThreshold"
                  name="lowStockThreshold"
                  type="number"
                  min={0}
                  defaultValue={row.lowStockThreshold}
                />
              </Field>

              <Field label="Why" htmlFor="reason" hint="Kept in the stock ledger.">
                <Input id="reason" name="reason" maxLength={300} placeholder="Stock count, delivery, breakage…" />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Apply
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
