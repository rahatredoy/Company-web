'use client';

import * as React from 'react';
import { GripVertical, Lock, Plus, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { api, ApiError, errorMessage } from '@/lib/api';
import { slugify } from '@/lib/slugify';
import { cn } from '@/lib/utils';
import type { AttributeRow, AttributeValueRow } from '@/lib/types';
import { SELECT_CLASS } from './category-tree';

/**
 * Add or edit one attribute, with its values, in a panel beside the list.
 *
 * The values are the awkward part. `PUT /attributes/:id` **merges** them — a value
 * left out of the list is kept, not deleted — because omission is
 * indistinguishable from a form that failed to load, and the cascade would unmake
 * every variant built on that value. So this panel saves renames and additions
 * with the attribute, and removing an existing value is its own request against
 * its own endpoint, refused by the API while any product still points at it. The
 * row says which case it is rather than offering a button that will be refused.
 */

interface ValueDraft {
  /** Absent on a value that does not exist yet. */
  id?: string;
  value: string;
  colorHex: string;
  variantCount: number;
  productCount: number;
  /** Unique across the list even before it is saved; React needs a stable key. */
  key: string;
}

interface Draft {
  name: string;
  slug: string;
  inputType: AttributeRow['inputType'];
  unit: string;
  sortOrder: string;
  isVariantAttribute: boolean;
  isFilterable: boolean;
  values: ValueDraft[];
}

let seed = 0;
const nextKey = () => `new-${(seed += 1)}`;

function valueDraft(value: AttributeValueRow): ValueDraft {
  return {
    id: value.id,
    value: value.value,
    colorHex: value.colorHex ?? '',
    variantCount: value.variantCount,
    productCount: value.productCount,
    key: value.id,
  };
}

function draftFrom(attribute: AttributeRow | null): Draft {
  return {
    name: attribute?.name ?? '',
    slug: attribute?.slug ?? '',
    inputType: attribute?.inputType ?? 'select',
    unit: attribute?.unit ?? '',
    sortOrder: String(attribute?.sortOrder ?? 0),
    isVariantAttribute: attribute?.isVariantAttribute ?? true,
    isFilterable: attribute?.isFilterable ?? true,
    values: (attribute?.values ?? []).map(valueDraft),
  };
}

export function AttributePanel({
  open,
  onOpenChange,
  attribute,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while adding. */
  attribute: AttributeRow | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(attribute));
  /** The slug follows the name until somebody edits it, then it stays put. */
  const [slugTouched, setSlugTouched] = React.useState(Boolean(attribute));
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const identity = `${open ? 'open' : 'shut'}:${attribute?.id ?? 'new'}`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setDraft(draftFrom(attribute));
    setSlugTouched(Boolean(attribute));
    setError('');
    setFieldErrors({});
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setValue = (key: string, patch: Partial<ValueDraft>) =>
    setDraft((current) => ({
      ...current,
      values: current.values.map((value) => (value.key === key ? { ...value, ...patch } : value)),
    }));

  const addValue = () =>
    setDraft((current) => ({
      ...current,
      values: [
        ...current.values,
        { value: '', colorHex: '', variantCount: 0, productCount: 0, key: nextKey() },
      ],
    }));

  /** A value that exists only in this form is dropped; a saved one is a request. */
  async function dropValue(row: ValueDraft) {
    if (!row.id || !attribute) {
      setDraft((current) => ({ ...current, values: current.values.filter((value) => value.key !== row.key) }));
      return;
    }

    if (!globalThis.confirm(`Delete the value “${row.value}”? This cannot be undone.`)) return;

    setRemoving(row.key);
    try {
      await api.delete(`/api/v1/admin/attributes/${attribute.id}/values/${row.id}`);
      setDraft((current) => ({ ...current, values: current.values.filter((value) => value.key !== row.key) }));
      toast.success('Value deleted.');
      onSaved();
    } catch (caught) {
      // Refused while products point at it — the API's own words are the useful
      // ones, because they name the reason.
      toast.error(errorMessage(caught));
    } finally {
      setRemoving(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});

    const values = draft.values
      .map((value) => ({
        ...(value.id ? { id: value.id } : {}),
        value: value.value.trim(),
        colorHex: draft.inputType === 'color' ? value.colorHex.trim() || null : null,
      }))
      .filter((value) => value.value !== '');

    /*
     * The slug is sent only when it is the thing being changed. The API
     * re-derives it from the name otherwise, and it is the key in the
     * storefront's filter query string — moving it on every save would break a
     * shared `?size=m` link every time somebody fixed a typo in the name.
     */
    const slug = draft.slug.trim();

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      inputType: draft.inputType,
      isVariantAttribute: draft.isVariantAttribute,
      isFilterable: draft.isFilterable,
      unit: draft.unit.trim() || null,
      sortOrder: Number(draft.sortOrder) || 0,
      values,
    };

    if (!attribute) {
      if (slug) payload.slug = slug;
    } else if (slug !== attribute.slug) {
      payload.slug = slug;
    }

    try {
      // PUT for both: creating takes the same body, and the API merges values
      // either way, so there is one shape to get right rather than two.
      if (attribute) await api.put(`/api/v1/admin/attributes/${attribute.id}`, payload);
      else await api.post('/api/v1/admin/attributes', payload);

      toast.success(attribute ? 'Attribute saved.' : 'Attribute added.');
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

  const swatches = draft.inputType === 'color';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{attribute ? 'Edit Attribute' : 'Add Attribute'}</SheetTitle>
            <SheetDescription>
              Size, Colour, Material — anything a product varies by, or that a shopper filters on.
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            {/* The attribute itself on the left, the values it offers on the
                right — the values are the one part that grows without limit, so
                they get a column of their own rather than pushing everything
                else off the bottom. */}
            <SheetColumns>
              <SheetColumn>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Attribute Name" htmlFor="attr-name" required error={fieldErrors.name}>
                    <Input
                      id="attr-name"
                      value={draft.name}
                      onChange={(event) => {
                        set('name', event.target.value);
                        if (!slugTouched) set('slug', slugify(event.target.value));
                      }}
                      required
                      maxLength={80}
                      autoFocus
                      placeholder="Size"
                    />
                  </Field>

                  {/*
                    The key this attribute is filtered by on the storefront —
                    `?size=m` is this field. It follows the name until it is
                    edited by hand, and then it stays put: a rename must not move
                    it, or every filtered link the shop has shared stops
                    selecting anything.
                  */}
                  <Field
                    label="Filter key"
                    htmlFor="attr-slug"
                    hint="Used in storefront filter links."
                    error={fieldErrors.slug}
                  >
                    <Input
                      id="attr-slug"
                      value={draft.slug}
                      onChange={(event) => {
                        setSlugTouched(true);
                        set('slug', event.target.value);
                      }}
                      onBlur={(event) => set('slug', slugify(event.target.value))}
                      placeholder="made-from-the-name"
                      maxLength={90}
                      className="font-mono text-xs"
                    />
                  </Field>

                  <Field
                    label="Unit"
                    htmlFor="attr-unit"
                    hint="cm, kg, ml — optional."
                    error={fieldErrors.unit}
                  >
                    <Input
                      id="attr-unit"
                      value={draft.unit}
                      onChange={(event) => set('unit', event.target.value)}
                      maxLength={16}
                    />
                  </Field>
                </div>

                <Field label="Shown As" htmlFor="attr-input-type" error={fieldErrors.inputType}>
                  <select
                    id="attr-input-type"
                    value={draft.inputType}
                    onChange={(event) => set('inputType', event.target.value as Draft['inputType'])}
                    className={SELECT_CLASS}
                  >
                    <option value="select">A list to choose from</option>
                    <option value="color">Colour swatches</option>
                    <option value="text">Free text</option>
                    <option value="number">A number</option>
                  </select>
                </Field>

                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label htmlFor="attr-variant">Buying option</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Picking a value selects a different thing to buy, with its own SKU, price and stock. Turn this
                        off for something that only narrows a listing.
                      </p>
                    </div>
                    <Switch
                      id="attr-variant"
                      checked={draft.isVariantAttribute}
                      onCheckedChange={(checked) => set('isVariantAttribute', checked)}
                    />
                  </div>

                  {attribute && attribute.variantCount > 0 && !draft.isVariantAttribute ? (
                    <Alert variant="warning">
                      {attribute.variantCount} variant{attribute.variantCount === 1 ? '' : 's'} already use this as a
                      buying option. Turning it off leaves them as they are, but the storefront stops offering the
                      choice.
                    </Alert>
                  ) : null}

                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <Label htmlFor="attr-filterable">Offer as a filter</Label>
                      <p className="mt-1 text-xs text-muted-foreground">Shown in the storefront’s filter panel.</p>
                    </div>
                    <Switch
                      id="attr-filterable"
                      checked={draft.isFilterable}
                      onCheckedChange={(checked) => set('isFilterable', checked)}
                    />
                  </div>
                </div>

                <Field
                  label="Sort Order"
                  htmlFor="attr-sort"
                  hint="Lower numbers come first in the storefront’s filter list."
                  error={fieldErrors.sortOrder}
                >
                  <Input
                    id="attr-sort"
                    type="number"
                    min={0}
                    max={100_000}
                    value={draft.sortOrder}
                    onChange={(event) => set('sortOrder', event.target.value)}
                    className="w-32"
                  />
                </Field>
              </SheetColumn>

              {/* ----------------------------------------------------- values */}
              <SheetColumn className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Values</Label>
                  <span className="text-xs text-muted-foreground">{draft.values.length} value(s)</span>
                </div>

                <div className="space-y-2">
                  {draft.values.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      No values yet. Add the ones shoppers will choose between.
                    </p>
                  ) : (
                    draft.values.map((row) => {
                      const locked = row.productCount > 0 || row.variantCount > 0;

                      return (
                        <div key={row.key} className="flex items-center gap-2">
                          <span className="grid size-6 shrink-0 place-items-center text-border-strong" aria-hidden>
                            <GripVertical className="size-4" />
                          </span>

                          <Input
                            value={row.value}
                            onChange={(event) => setValue(row.key, { value: event.target.value })}
                            placeholder="Medium"
                            maxLength={120}
                            aria-label="Value"
                          />

                          {swatches ? (
                            <input
                              type="color"
                              value={row.colorHex || '#000000'}
                              onChange={(event) => setValue(row.key, { colorHex: event.target.value })}
                              aria-label={`Colour for ${row.value || 'this value'}`}
                              className="size-10 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1"
                            />
                          ) : null}

                          {locked ? (
                            <Badge variant="neutral" className="shrink-0" title="Used by products">
                              <Lock className="size-3" aria-hidden />
                              {row.productCount || row.variantCount}
                            </Badge>
                          ) : null}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            loading={removing === row.key}
                            onClick={() => void dropValue(row)}
                            aria-label={`Remove ${row.value || 'this value'}`}
                            className={cn('shrink-0', locked && 'text-muted-foreground')}
                          >
                            {removing === row.key ? null : <X />}
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>

                <Button type="button" variant="outline" size="sm" onClick={addValue}>
                  <Plus /> Add value
                </Button>

                {fieldErrors.values ? <p className="text-xs text-destructive">{fieldErrors.values}</p> : null}

                <p className="text-xs text-muted-foreground">
                  A value in use is marked with a lock and the number of products behind it — the API refuses to
                  delete one until those products stop using it.
                </p>
              </SheetColumn>
            </SheetColumns>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {attribute ? 'Save Attribute' : 'Add Attribute'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
