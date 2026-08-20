'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CouponRow } from '@/lib/types';
import { api, ApiError, errorMessage, type ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import { formatDate, formatMoney } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogColumn,
  DialogColumns,
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
import { toast } from '@/components/ui/toaster';
import { InfiniteTable, type Column } from './infinite-table';
import { CouponDetail } from './coupon-detail';

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
  initial,
  query,
  currency,
  canManage,
}: {
  /** The first batch, rendered on the server. The rest arrive by cursor. */
  initial: { rows: CouponRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const list = useInfiniteList<CouponRow>({ path: '/api/v1/admin/coupons', query, initial });

  /*
   * The read-only panel. It is the only place the redemptions are visible —
   * the list shows `used_count`, which says how often a code was claimed but
   * not by how many different people, and the two are a different problem.
   */
  const viewing = useViewTarget<CouponRow>();
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

  /*
   * Columns as data. A virtualised table holds only the rows on screen, so it
   * cannot size its columns from its contents — these widths are what go in its
   * `<colgroup>`. `Conditions` carries none: it takes whatever is left.
   */
  const columns: Column<CouponRow>[] = [
    {
      key: 'code',
      width: '14rem',
      header: 'Code',
      cell: (row) => (
        <>
          <span className="block font-mono font-medium">{row.code}</span>
          {row.description ? (
            <span className="block truncate text-xs text-muted-foreground">{row.description}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'worth',
      width: '9rem',
      header: 'Worth',
      className: 'font-medium',
      cell: (row) => worth(row),
    },
    {
      key: 'conditions',
      header: 'Conditions',
      className: 'text-sm text-muted-foreground',
      cell: (row) => (
        <span className="block truncate">
          {row.minOrderAmount ? `Baskets over ${formatMoney(row.minOrderAmount, currency)}` : 'Any basket'}
          {row.perCustomerLimit ? ` · ${row.perCustomerLimit} per customer` : ''}
        </span>
      ),
    },
    {
      key: 'until',
      width: '10rem',
      header: 'Runs until',
      className: 'text-sm text-muted-foreground',
      cell: (row) => (row.endsAt ? formatDate(row.endsAt) : 'No end date'),
    },
    {
      key: 'used',
      width: '7rem',
      header: 'Used',
      headClassName: 'text-right',
      className: 'text-right tabular-nums',
      cell: (row) => `${row.usedCount}${row.usageLimit ? ` / ${row.usageLimit}` : ''}`,
    },
    {
      key: 'status',
      width: '9rem',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      width: '10rem',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => viewing.view(row)} aria-label={`View ${row.code}`}>
            <Eye aria-hidden />
          </Button>
          {canManage ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => openFor(row)} aria-label={`Edit ${row.code}`}>
                <Pencil aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(row)} aria-label={`Remove ${row.code}`}>
                <Trash2 aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      {canManage ? (
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> Add a code
        </Button>
      ) : null}

      <InfiniteTable
        columns={columns}
        rows={list.rows}
        total={list.total}
        noun="code"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="66rem"
        estimateRowHeight={62}
        empty="No discount codes yet."
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${editing.code}` : 'New discount code'}</DialogTitle>
              <DialogDescription>
                Customers type this at checkout. Your store works out the discount, not their browser.
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* What the code is and what it takes off, beside the limits on
                  who may use it and until when. */}
              <DialogColumns>
                <DialogColumn>
                  <Field
                    label="Code"
                    htmlFor="code"
                    required
                    error={fieldErrors.code}
                    hint="Letters, numbers and dashes."
                  >
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
                    <Input
                      id="description"
                      name="description"
                      defaultValue={editing?.description ?? ''}
                      maxLength={200}
                    />
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
                </DialogColumn>

                <DialogColumn>
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
                      <Input
                        id="startsAt"
                        name="startsAt"
                        type="date"
                        defaultValue={editing?.startsAt?.slice(0, 10) ?? ''}
                      />
                    </Field>
                    <Field label="Ends" htmlFor="endsAt">
                      <Input id="endsAt" name="endsAt" type="date" defaultValue={editing?.endsAt?.slice(0, 10) ?? ''} />
                    </Field>
                  </div>

                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isActive" defaultChecked={(editing?.status ?? 'active') === 'active'} />
                    Accept this code at checkout
                  </label>
                </DialogColumn>
              </DialogColumns>
            </DialogBody>

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

      <CouponDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        currency={currency}
      />
    </>
  );
}
