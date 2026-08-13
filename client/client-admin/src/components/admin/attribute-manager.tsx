'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { AttributeRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

/**
 * Product attributes — Size, Colour, Material.
 *
 * Two kinds, and the difference decides what a shopper sees. A **variant**
 * attribute means picking a value selects a different thing to buy, with its own
 * SKU, price and stock. A descriptive one only narrows a listing. Getting that
 * backwards is why a shop ends up with "Colour" as a filter that cannot actually
 * be bought.
 *
 * Values are merged, never replaced: one already attached to a product variant
 * cannot be removed by leaving it out of the list, because that would unmake the
 * product's options.
 */
export function AttributeManager({ rows, canManage }: { rows: AttributeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AttributeRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const openFor = (row: AttributeRow | null) => {
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

    // One value per line, so adding six sizes is six keystrokes rather than six
    // dialogs. Existing values keep their id and are matched by name.
    const existing = new Map((editing?.values ?? []).map((value) => [value.value.toLowerCase(), value.id]));
    const values = text('values')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((value) => {
        const id = existing.get(value.toLowerCase());
        return id ? { id, value, colorHex: null } : { value, colorHex: null };
      });

    const payload = {
      name: text('name'),
      inputType: text('inputType'),
      isVariantAttribute: data.get('isVariantAttribute') === 'on',
      isFilterable: data.get('isFilterable') === 'on',
      unit: text('unit') || null,
      sortOrder: Number(data.get('sortOrder') ?? 0),
      values,
    };

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      if (editing) await api.put(`/api/v1/admin/attributes/${editing.id}`, payload);
      else await api.post('/api/v1/admin/attributes', payload);

      setOpen(false);
      toast.success('Attribute saved.');
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

  const remove = async (row: AttributeRow) => {
    if (!window.confirm(`Remove ${row.name}?`)) return;

    try {
      await api.delete(`/api/v1/admin/attributes/${row.id}`);
      toast.success('Attribute removed.');
      router.refresh();
    } catch (caught) {
      // Refused when products use it — the API's message says which case it is.
      toast.error(errorMessage(caught));
    }
  };

  return (
    <>
      {canManage ? (
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> Add an attribute
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No attributes yet. Add one to give products options like size or colour.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {row.name}
                      {row.unit ? <span className="text-muted-foreground"> ({row.unit})</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.isVariantAttribute ? 'Picking a value buys a different item' : 'Narrows a listing only'}
                    </p>
                  </div>
                  {row.isFilterable ? <Badge variant="info">Filter</Badge> : null}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {row.values.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No values yet.</span>
                  ) : (
                    row.values.map((value) => (
                      <Badge key={value.id} variant="neutral">
                        {value.value}
                      </Badge>
                    ))
                  )}
                </div>

                {canManage ? (
                  <div className="flex gap-1 pt-1">
                    <Button variant="ghost" size="sm" onClick={() => openFor(row)}>
                      <Pencil aria-hidden /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${editing.name}` : 'New attribute'}</DialogTitle>
              <DialogDescription>Size, Colour, Material — anything a product varies by.</DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <Field label="Name" htmlFor="name" required error={fieldErrors.name}>
                <Input id="name" name="name" defaultValue={editing?.name ?? ''} maxLength={80} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Shown as" htmlFor="inputType">
                  <select id="inputType" name="inputType" defaultValue={editing?.inputType ?? 'select'} className={SELECT_CLASS}>
                    <option value="select">A list to choose from</option>
                    <option value="color">Colour swatches</option>
                    <option value="text">Free text</option>
                    <option value="number">A number</option>
                  </select>
                </Field>
                <Field label="Unit" htmlFor="unit" hint="cm, kg, ml — optional.">
                  <Input id="unit" name="unit" defaultValue={editing?.unit ?? ''} maxLength={16} />
                </Field>
              </div>

              <Field
                label="Values"
                htmlFor="values"
                hint="One per line. Removing a line does not delete a value products already use."
              >
                <Textarea
                  id="values"
                  name="values"
                  rows={6}
                  defaultValue={(editing?.values ?? []).map((value) => value.value).join('\n')}
                  placeholder={'Small\nMedium\nLarge'}
                />
              </Field>

              <Field label="Order" htmlFor="sortOrder">
                <Input id="sortOrder" name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} />
              </Field>

              <label className="flex items-center gap-3 text-sm">
                <Switch name="isVariantAttribute" defaultChecked={editing?.isVariantAttribute ?? true} />
                Picking a value buys a different item
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Switch name="isFilterable" defaultChecked={editing?.isFilterable ?? true} />
                Offer it as a filter on your storefront
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save attribute
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
