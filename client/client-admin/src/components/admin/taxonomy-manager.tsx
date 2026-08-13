'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
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
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';

/**
 * Categories and brands are the same screen with different columns: a flat
 * list, a dialog to add or rename, and a delete that has to explain itself.
 * One component, because two near-identical copies would drift the moment one
 * of them gained a field.
 *
 * The rows are rendered by the server page and passed in; this only owns the
 * dialog and the writes, then asks Next to re-render rather than keeping its own
 * copy of the list in state that could disagree with the database.
 */
export interface TaxonomyRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount: number;
  /** Categories only. */
  parentId?: string | null;
  parentName?: string | null;
}

interface Props {
  kind: 'category' | 'brand';
  rows: TaxonomyRow[];
  /** Parent options, categories only. */
  parents?: { id: string; name: string }[];
  canManage: boolean;
}

const COPY = {
  category: {
    endpoint: '/api/v1/admin/categories',
    one: 'category',
    add: 'New category',
    empty: 'No categories yet. Add the first one to start grouping your products.',
  },
  brand: {
    endpoint: '/api/v1/admin/brands',
    one: 'brand',
    add: 'New brand',
    empty: 'No brands yet. Add one to label who makes what you sell.',
  },
} as const;

export function TaxonomyManager({ kind, rows, parents = [], canManage }: Props) {
  const router = useRouter();
  const copy = COPY[kind];

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TaxonomyRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  function openFor(row: TaxonomyRow | null) {
    setEditing(row);
    setError('');
    setFieldErrors({});
    setOpen(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const parentId = String(form.get('parentId') ?? '').trim();

    const payload: Record<string, unknown> = {
      name: String(form.get('name') ?? '').trim(),
      isActive: form.get('isActive') === 'on',
    };
    if (kind === 'category') payload.parentId = parentId === '' ? null : parentId;

    try {
      if (editing) await api.patch(`${copy.endpoint}/${editing.id}`, payload);
      else await api.post(copy.endpoint, payload);

      toast.success(editing ? 'Saved.' : `${copy.one[0]!.toUpperCase()}${copy.one.slice(1)} added.`);
      setOpen(false);
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

  async function remove(row: TaxonomyRow) {
    // Products are not deleted with it — the database sets their reference to
    // null — so the confirmation says so rather than letting someone assume the
    // worst and never press the button.
    const warning =
      row.productCount > 0
        ? `\n\n${formatNumber(row.productCount)} product${row.productCount === 1 ? '' : 's'} will stay, without ${kind === 'category' ? 'a category' : 'a brand'}.`
        : '';

    if (!window.confirm(`Delete “${row.name}”?${warning}`)) return;

    try {
      await api.delete(`${copy.endpoint}/${row.id}`);
      toast.success('Deleted.');
      router.refresh();
    } catch (caught) {
      // A category with children is refused by the API; showing its own words is
      // more useful than a generic failure.
      toast.error(errorMessage(caught));
    }
  }

  return (
    <>
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => openFor(null)}>
            <Plus /> {copy.add}
          </Button>
        </div>
      ) : null}

      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {kind === 'category' ? <TableHead>Parent</TableHead> : null}
              <TableHead>Web address</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={kind === 'category' ? 6 : 5}>{copy.empty}</TableEmpty>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  {kind === 'category' ? (
                    <TableCell className="text-muted-foreground">{row.parentName ?? '—'}</TableCell>
                  ) : null}
                  <TableCell className="font-mono text-xs text-muted-foreground">/{row.slug}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatNumber(row.productCount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? 'Active' : 'Hidden'}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => openFor(row)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${row.name}`}
                          onClick={() => remove(row)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableWrapper>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${copy.one}` : copy.add}</DialogTitle>
              <DialogDescription>
                The web address is made from the name, and does not change when you rename it later.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <Field label="Name" htmlFor="name" required error={fieldErrors.name}>
                <Input id="name" name="name" defaultValue={editing?.name ?? ''} required maxLength={140} autoFocus />
              </Field>

              {kind === 'category' ? (
                <Field label="Parent category" htmlFor="parentId" error={fieldErrors.parentId}>
                  <select
                    id="parentId"
                    name="parentId"
                    defaultValue={editing?.parentId ?? ''}
                    className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="">None — top level</option>
                    {parents
                      .filter((parent) => parent.id !== editing?.id)
                      .map((parent) => (
                        <option key={parent.id} value={parent.id}>
                          {parent.name}
                        </option>
                      ))}
                  </select>
                </Field>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="isActive">Visible on the storefront</Label>
                <Switch id="isActive" name="isActive" defaultChecked={editing?.isActive ?? true} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
