'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ExternalLink, Minus, Package, Pencil, Plus, RotateCcw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetBody,
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
import type { InventoryBucket, ProductInsights, ProductStatus, WarehouseRow } from '@/lib/types';
import { SELECT_CLASS } from './category-tree';

/**
 * The five things an owner does to a product from its own screen.
 *
 * They live together in one client component because three of them are the same
 * sheet with a different opening position, and because the two that write have
 * to refresh the page that shows what they changed — a stock move that leaves
 * the counts above it stale is worse than no button at all.
 *
 * Nothing here decides what is allowed. Every one of these calls is checked
 * again by the API against the signed-in admin's permissions; `canManage` and
 * `canAdjust` only decide whether a control that would be refused is offered.
 */

type Mode = 'add' | 'adjust';

const BUCKETS: { value: InventoryBucket; label: string; hint: string }[] = [
  { value: 'available', label: 'Available', hint: 'Sellable right now' },
  { value: 'damaged', label: 'Damaged', hint: 'Held back, never sold' },
  { value: 'incoming', label: 'Incoming', hint: 'On order, not yet received' },
];

/** Common receiving amounts, so the usual case is one tap. */
const QUICK = [1, 5, 10, 25, 50];

export function ProductActions({
  product,
  variants,
  warehouses,
  storefrontUrl,
  canManage,
  canAdjust,
}: {
  product: { id: string; slug: string; status: ProductStatus };
  variants: ProductInsights['variants'];
  warehouses: WarehouseRow[];
  /** Null when the panel is reached on a custom domain, which carries no slug. */
  storefrontUrl: string | null;
  canManage: boolean;
  canAdjust: boolean;
}) {
  const [mode, setMode] = React.useState<Mode | null>(null);
  const archived = product.status === 'inactive';

  return (
    <>
      <Button asChild size="sm" variant="outline">
        <Link href={`/products/${product.id}?tab=details`}>
          <Pencil /> Edit product
        </Link>
      </Button>

      {canAdjust ? (
        <>
          <Button size="sm" onClick={() => setMode('add')}>
            <Plus /> Add stock
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode('adjust')}>
            <Package /> Adjust stock
          </Button>
        </>
      ) : null}

      {storefrontUrl ? (
        <Button asChild size="sm" variant="outline">
          <a href={`${storefrontUrl}/product/${product.slug}`} target="_blank" rel="noreferrer">
            <ExternalLink /> View in store
          </a>
        </Button>
      ) : null}

      {canManage ? <ArchiveButton productId={product.id} archived={archived} /> : null}

      <StockPanel
        mode={mode}
        onClose={() => setMode(null)}
        variants={variants}
        warehouses={warehouses}
      />
    </>
  );
}

/**
 * Archiving, and putting back.
 *
 * A `PATCH` to `inactive` rather than the delete endpoint: deleting a product
 * that has never sold really removes it, and an owner reaching for "archive"
 * means "take it off the shop", not "erase it". The delete is still on the
 * details tab, where it is a deliberate act rather than one button along from
 * the stock controls.
 */
function ArchiveButton({ productId, archived }: { productId: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    try {
      await api.patch(`/api/v1/admin/products/${productId}`, { status: archived ? 'draft' : 'inactive' });
      toast.success(archived ? 'Product restored as a draft.' : 'Product archived and taken off the shop.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={archived ? 'outline' : 'ghost'} onClick={run} loading={busy}>
      {archived ? (
        <>
          <RotateCcw /> Restore
        </>
      ) : (
        <>
          <Archive /> Archive
        </>
      )}
    </Button>
  );
}

/**
 * Receiving stock, and correcting it.
 *
 * One sheet, two openings. **Add** is the everyday case — a delivery arrived, so
 * the amount is positive and it goes into `available` without asking which
 * count. **Adjust** is the correction, where the amount is signed and any of the
 * three buckets is fair game.
 *
 * The amount is a **delta**, never a new total, and that is the point: two
 * people counting the same shelf both submit "+12 found" and both are right,
 * whereas both submitting "now 40" means one of them silently loses. The API
 * applies it as a single conditional `UPDATE` for the same reason, and the
 * database refuses anything that would drive a bucket below zero — so a removal
 * larger than the shelf is rejected rather than clamped to zero and quietly
 * losing the difference.
 */
function StockPanel({
  mode,
  onClose,
  variants,
  warehouses,
}: {
  mode: Mode | null;
  onClose: () => void;
  variants: ProductInsights['variants'];
  warehouses: WarehouseRow[];
}) {
  const router = useRouter();
  const open = mode !== null;
  const adding = mode === 'add';

  const usable = warehouses.filter((row) => row.isActive);
  const defaultWarehouse = usable.find((row) => row.isDefault) ?? usable[0];

  const [variantId, setVariantId] = React.useState(variants[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = React.useState(defaultWarehouse?.id ?? '');
  const [bucket, setBucket] = React.useState<InventoryBucket>('available');
  const [amount, setAmount] = React.useState('0');
  const [reason, setReason] = React.useState('');
  const [threshold, setThreshold] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Reset on every open rather than on close, so whatever the API refused stays
  // readable for as long as the sheet that caused it. Adjusted during render; an
  // effect would show the previous opening's numbers for a frame.
  const identity = `${mode ?? 'shut'}`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    if (mode) {
      setVariantId(variants[0]?.id ?? '');
      setWarehouseId(defaultWarehouse?.id ?? '');
      setBucket('available');
      setAmount('0');
      setReason('');
      setThreshold('');
      setError('');
      setFieldErrors({});
    }
  }

  const variant = variants.find((row) => row.id === variantId) ?? null;
  const typed = Number(amount) || 0;
  // Add only ever puts units on: a negative typed into the receiving form is a
  // removal nobody asked for, so it is read as its own magnitude.
  const delta = adding ? Math.abs(typed) : typed;

  const held = variant
    ? bucket === 'available'
      ? variant.available
      : bucket === 'damaged'
        ? variant.damaged
        : bucket === 'incoming'
          ? variant.incoming
          : bucket === 'reserved'
            ? variant.reserved
            : variant.returnPending
    : 0;

  const after = held + delta;
  const wantsThreshold = threshold.trim() !== '' && Number(threshold) !== (variant?.lowStockThreshold ?? 0);
  const nothingToDo = delta === 0 && !wantsThreshold;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!variantId || !warehouseId || nothingToDo) return;

    setBusy(true);
    setError('');
    setFieldErrors({});

    try {
      if (delta !== 0) {
        // The warning line rides along with a real movement — one request, one
        // ledger row, and the two can never be half-applied.
        await api.post('/api/v1/admin/inventory/adjust', {
          variantId,
          warehouseId,
          bucket: adding ? 'available' : bucket,
          delta,
          reason: reason.trim() || undefined,
          ...(wantsThreshold ? { lowStockThreshold: Number(threshold) || 0 } : {}),
        });
      } else {
        await api.patch('/api/v1/admin/inventory/threshold', {
          variantId,
          warehouseId,
          lowStockThreshold: Number(threshold) || 0,
        });
      }

      toast.success(
        delta === 0
          ? 'Warning line saved.'
          : `${variant?.sku ?? 'Stock'}: ${delta > 0 ? '+' : ''}${formatNumber(delta)} ${(adding ? 'available' : bucket).replace('_', ' ')}.`,
      );
      onClose();
      router.refresh();
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
    <Sheet open={open} onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <SheetContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{adding ? 'Add stock' : 'Adjust stock'}</SheetTitle>
            <SheetDescription>
              {adding
                ? 'A delivery arrived. The amount is added to what is already on the shelf.'
                : 'A correction. Positive adds, negative removes, and the count can never go below zero.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            {usable.length === 0 ? (
              <Alert variant="warning">
                This store has no active warehouse, so there is nowhere for stock to land. Add one under
                Inventory first.
              </Alert>
            ) : null}

            {variants.length > 1 ? (
              <Field label="Which variant" htmlFor="stock-variant">
                <select
                  id="stock-variant"
                  value={variantId}
                  onChange={(event) => setVariantId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  {variants.map((row) => (
                    <option key={row.id} value={row.id}>
                      {[row.title, row.sku].filter(Boolean).join(' · ')} — {formatNumber(row.available)} available
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {usable.length > 1 ? (
              <Field label="Warehouse" htmlFor="stock-warehouse">
                <select
                  id="stock-warehouse"
                  value={warehouseId}
                  onChange={(event) => setWarehouseId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  {usable.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {variant ? (
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3 text-sm">
                <Count label="Available" value={variant.available} strong />
                <Count label="Reserved" value={variant.reserved} />
                <Count label="Incoming" value={variant.incoming} />
                <Count label="Damaged" value={variant.damaged} />
                <Count label="Returns" value={variant.returnPending} />
                <Count label="Warn at" value={variant.lowStockThreshold} />
              </div>
            ) : null}

            {adding ? null : (
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
            )}

            <Field
              label={adding ? 'How many arrived' : 'Change by'}
              htmlFor="stock-amount"
              hint={adding ? undefined : 'Positive adds, negative removes. 12 received, or −3 broken.'}
              error={fieldErrors.delta}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {adding ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setAmount(String(typed - 1))}
                      aria-label="One less"
                    >
                      <Minus />
                    </Button>
                  )}
                  <Input
                    id="stock-amount"
                    type="number"
                    step={1}
                    min={adding ? 0 : undefined}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="text-center tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setAmount(String(typed + 1))}
                    aria-label="One more"
                  >
                    <Plus />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1">
                  {(adding ? QUICK : [-10, -5, -1, 1, 5, 10]).map((step) => (
                    <Button
                      key={step}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAmount(String(typed + step))}
                    >
                      {step > 0 ? `+${step}` : step}
                    </Button>
                  ))}
                  {typed !== 0 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAmount('0')}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </Field>

            {delta !== 0 && variant ? (
              <div
                className={cn(
                  'flex items-center justify-between rounded-lg border p-3 text-sm',
                  after < 0 ? 'border-destructive/40 bg-destructive-soft' : 'border-border bg-muted/50',
                )}
              >
                <span className="text-muted-foreground">
                  {(adding ? 'Available' : (BUCKETS.find((o) => o.value === bucket)?.label ?? bucket))} after this
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
                placeholder={adding ? 'Delivery, purchase order…' : 'Stock count, breakage…'}
              />
            </Field>

            <Field
              label="Low-stock warning at"
              htmlFor="stock-threshold"
              hint="At or below this the product is flagged low. Leave blank to keep it as it is."
              error={fieldErrors.lowStockThreshold}
            >
              <Input
                id="stock-threshold"
                type="number"
                min={0}
                max={100_000}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                placeholder={String(variant?.lowStockThreshold ?? 0)}
                className="w-32 tabular-nums"
              />
            </Field>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={nothingToDo || !variantId || !warehouseId}>
              {delta === 0 ? 'Save warning line' : adding ? 'Add to stock' : 'Apply change'}
            </Button>
          </SheetFooter>
        </form>
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
