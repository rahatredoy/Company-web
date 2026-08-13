'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { CouponRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
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
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';

/** Radix Select contributes nothing to FormData, so these stay plain selects. */
const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

/**
 * Discount codes.
 *
 * Every field here is read at checkout by the API's own `applyCoupon`, and the
 * basket checks against that same function before it shows a figure — so what a
 * shopper is quoted and what they are charged come from one place. The
 * storefront used to hold its own copy of these rules and the two disagreed.
 *
 * `Used` is not editable. It is incremented inside the order transaction and is
 * the only honest count of how often a code has been claimed.
 */
export function CouponManager({
  rows,
  currency,
  canManage,
}: {
  rows: CouponRow[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CouponRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const openFor = (row: CouponRow | null) => {
    setEditing(row);
    setError('');
    setFieldErrors({});
    setOpen(true);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const optional = (name: string) => text(name) || null;
    const number = (name: string) => (text(name) ? Number(text(name)) : null);

    const payload = {
      code: text('code'),
      description: optional('description'),
      type: text('type'),
      value: text('value') || '0',
      maxDiscountAmount: optional('maxDiscountAmount'),
      minOrderAmount: optional('minOrderAmount'),
      usageLimit: number('usageLimit'),
      perCustomerLimit: number('perCustomerLimit'),
      startsAt: optional('startsAt'),
      endsAt: optional('endsAt'),
      status: data.get('isActive') === 'on' ? 'active' : 'disabled',
    };

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      if (editing) await api.put(`/api/v1/admin/coupons/${editing.id}`, payload);
      else await api.post('/api/v1/admin/coupons', payload);

      setOpen(false);
      toast.success('Code saved.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CouponRow) => {
    if (!window.confirm(`Remove ${row.code}?`)) return;

    try {
      // A code that has been claimed is switched off rather than deleted —
      // redemptions point at it. The API says so in its own words.
      const result = await api.delete<{ message?: string } | undefined>(`/api/v1/admin/coupons/${row.id}`);
      toast.success(result?.message ?? 'Code removed.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const worth = (row: CouponRow) =>
    row.type === 'percentage'
      ? `${Number(row.value)}% off`
      : row.type === 'free_shipping'
        ? 'Free delivery'
        : `${formatMoney(row.value, currency)} off`;

  return (
    <>
      {canManage ? (
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> Add a code
        </Button>
      ) : null}

      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Worth</TableHead>
              <TableHead>Conditions</TableHead>
              <TableHead>Runs until</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>No discount codes yet.</TableEmpty>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="block font-mono font-medium">{row.code}</span>
                    {row.description ? (
                      <span className="block text-xs text-muted-foreground">{row.description}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">{worth(row)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.minOrderAmount ? `Baskets over ${formatMoney(row.minOrderAmount, currency)}` : 'Any basket'}
                    {row.perCustomerLimit ? ` · ${row.perCustomerLimit} per customer` : ''}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.endsAt ? formatDate(row.endsAt) : 'No end date'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.usedCount}
                    {row.usageLimit ? ` / ${row.usageLimit}` : ''}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openFor(row)} aria-label={`Edit ${row.code}`}>
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(row)} aria-label={`Remove ${row.code}`}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableWrapper>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${editing.code}` : 'New discount code'}</DialogTitle>
              <DialogDescription>
                Customers type this at checkout. Your store works out the discount, not their browser.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <Field label="Code" htmlFor="code" required error={fieldErrors.code} hint="Letters, numbers and dashes.">
                <Input
                  id="code"
                  name="code"
                  defaultValue={editing?.code ?? ''}
                  maxLength={40}
                  className="font-mono uppercase"
                />
              </Field>

              <Field
                label="Description"
                htmlFor="description"
                hint="Shown in the basket once the code is applied."
              >
                <Input id="description" name="description" defaultValue={editing?.description ?? ''} maxLength={200} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kind" htmlFor="type">
                  <select id="type" name="type" defaultValue={editing?.type ?? 'percentage'} className={SELECT_CLASS}>
                    <option value="percentage">Percentage off</option>
                    <option value="fixed">Fixed amount off</option>
                    <option value="free_shipping">Free delivery</option>
                  </select>
                </Field>
                <Field
                  label="Amount"
                  htmlFor="value"
                  required
                  error={fieldErrors.value}
                  hint="20 means 20% or 20.00."
                >
                  <Input id="value" name="value" defaultValue={editing?.value ?? ''} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Minimum basket" htmlFor="minOrderAmount" error={fieldErrors.minOrderAmount}>
                  <Input id="minOrderAmount" name="minOrderAmount" defaultValue={editing?.minOrderAmount ?? ''} />
                </Field>
                <Field label="Cap the discount at" htmlFor="maxDiscountAmount">
                  <Input
                    id="maxDiscountAmount"
                    name="maxDiscountAmount"
                    defaultValue={editing?.maxDiscountAmount ?? ''}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Total uses" htmlFor="usageLimit" hint="Empty means unlimited.">
                  <Input
                    id="usageLimit"
                    name="usageLimit"
                    type="number"
                    min={1}
                    defaultValue={editing?.usageLimit ?? ''}
                  />
                </Field>
                <Field label="Uses per customer" htmlFor="perCustomerLimit">
                  <Input
                    id="perCustomerLimit"
                    name="perCustomerLimit"
                    type="number"
                    min={1}
                    defaultValue={editing?.perCustomerLimit ?? ''}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts" htmlFor="startsAt">
                  <Input id="startsAt" name="startsAt" type="date" defaultValue={editing?.startsAt?.slice(0, 10) ?? ''} />
                </Field>
                <Field label="Ends" htmlFor="endsAt">
                  <Input id="endsAt" name="endsAt" type="date" defaultValue={editing?.endsAt?.slice(0, 10) ?? ''} />
                </Field>
              </div>

              <label className="flex items-center gap-3 text-sm">
                <Switch name="isActive" defaultChecked={(editing?.status ?? 'active') === 'active'} />
                Accept this code at checkout
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save code
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
