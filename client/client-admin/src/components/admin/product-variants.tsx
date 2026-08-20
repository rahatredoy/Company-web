'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { AttributeRow, ProductVariant } from '@/lib/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { isoFromLocalInput, localInputValue } from '@/lib/local-datetime';

const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm';

/** The API accepts at most six option values on one variant. */
const MAX_OPTIONS = 6;

interface Draft {
  key: string;
  sku: string;
  title: string;
  price: string;
  salePrice: string;
  /** Local-clock strings for the two `datetime-local` boxes; '' means no bound. */
  saleStartsAt: string;
  saleEndsAt: string;
  costPrice: string;
  barcode: string;
  weightGrams: string;
  imageUrl: string;
  isActive: boolean;
  isDefault: boolean;
  /** attributeId → attributeValueId. One value per attribute, as the table's key requires. */
  selection: Record<string, string>;
  /**
   * Whether this row is a variant that does not exist yet.
   *
   * It decides which of the two stock controls the row gets, and that split is
   * the API's rule rather than a UI preference: a new variant is given an
   * opening balance with the ledger row that says so, while an existing one's
   * count only ever moves by a signed adjustment on the Inventory screen. A box
   * that wrote an absolute number over a counted variant would be a stock
   * movement with no movement behind it.
   */
  isNew: boolean;
  /** Opening balance for a new row; ignored by the API for one that exists. */
  stockQuantity: string;
  /** What an existing row has on the shelf now. `null` means never counted. */
  onShelf: number | null;
}

let counter = 0;
const nextKey = () => `variant-${(counter += 1)}`;

function draftFrom(variant: ProductVariant, valueToAttribute: Map<string, string>): Draft {
  const selection: Record<string, string> = {};
  for (const valueId of variant.attributeValueIds) {
    const attributeId = valueToAttribute.get(valueId);
    if (attributeId) selection[attributeId] = valueId;
  }

  return {
    key: nextKey(),
    sku: variant.sku,
    title: variant.title ?? '',
    price: variant.price,
    salePrice: variant.salePrice ?? '',
    saleStartsAt: localInputValue(variant.saleStartsAt),
    saleEndsAt: localInputValue(variant.saleEndsAt),
    costPrice: variant.costPrice ?? '',
    barcode: variant.barcode ?? '',
    weightGrams: variant.weightGrams === null ? '' : String(variant.weightGrams),
    imageUrl: variant.imageUrl ?? '',
    isActive: variant.isActive,
    isDefault: variant.isDefault,
    selection,
    isNew: false,
    stockQuantity: '',
    onShelf: variant.stock,
  };
}

/**
 * The things a shopper actually buys.
 *
 * A variant owns the SKU, the price and the stock, so this list is the product's
 * real inventory. Even a simple product has exactly one — that is what lets
 * pricing, stock and order lines have a single code path everywhere else.
 *
 * Two consequences worth knowing before editing, both of which the API enforces
 * rather than this form. **A variant is matched by SKU**, so changing a SKU is
 * not a rename: the old variant is deleted and a new one takes its place,
 * without the stock. And **a variant removed from this list is deleted along
 * with its stock levels** — order history survives, because a line keeps its own
 * name and price snapshot, but the warehouse count does not. Both are said on
 * screen for the same reason.
 */
export function ProductVariants({
  productId,
  variants,
  attributes,
  currency,
  canManage,
}: {
  productId: string;
  variants: ProductVariant[];
  attributes: AttributeRow[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();

  const options = React.useMemo(
    () => attributes.filter((attribute) => attribute.isVariantAttribute).slice(0, MAX_OPTIONS),
    [attributes],
  );

  const valueToAttribute = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const attribute of attributes) {
      for (const value of attribute.values) map.set(value.id, attribute.id);
    }
    return map;
  }, [attributes]);

  const [rows, setRows] = React.useState<Draft[]>(() =>
    variants.map((variant) => draftFrom(variant, valueToAttribute)),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const patch = (key: string, change: Partial<Draft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  /** Exactly one, so the product page always has a variant to open on. */
  const makeDefault = (key: string) =>
    setRows((current) => current.map((row) => ({ ...row, isDefault: row.key === key })));

  const choose = (key: string, attributeId: string, valueId: string) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const selection = { ...row.selection };
        if (valueId) selection[attributeId] = valueId;
        else delete selection[attributeId];
        return { ...row, selection };
      }),
    );

  const add = (from?: Draft) => {
    const key = nextKey();
    setRows((current) => [
      ...current,
      from
        ? {
            ...from,
            key,
            sku: '',
            barcode: '',
            isDefault: current.length === 0,
            // A duplicate is a new variant, not a copy of the original's shelf:
            // stock follows the SKU, and this row has not got one yet.
            isNew: true,
            stockQuantity: '0',
            onShelf: null,
          }
        : {
            key,
            sku: '',
            title: '',
            price: '',
            salePrice: '',
            saleStartsAt: '',
            saleEndsAt: '',
            costPrice: '',
            barcode: '',
            weightGrams: '',
            imageUrl: '',
            isActive: true,
            isDefault: current.length === 0,
            selection: {},
            isNew: true,
            stockQuantity: '0',
            onShelf: null,
          },
    ]);
  };

  const remove = (key: string) => {
    const row = rows.find((item) => item.key === key);
    if (row?.sku && !window.confirm(`Delete ${row.sku}? Its stock levels go with it.`)) return;

    setRows((current) => {
      const next = current.filter((item) => item.key !== key);
      // The default cannot simply vanish with the row that held it.
      if (next.length > 0 && !next.some((item) => item.isDefault)) next[0] = { ...next[0]!, isDefault: true };
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');

    const payload = rows.map((row, index) => ({
      sku: row.sku.trim(),
      title: row.title.trim() || null,
      price: row.price.trim(),
      salePrice: row.salePrice.trim() || null,
      saleStartsAt: isoFromLocalInput(row.saleStartsAt),
      saleEndsAt: isoFromLocalInput(row.saleEndsAt),
      costPrice: row.costPrice.trim() || null,
      barcode: row.barcode.trim() || null,
      weightGrams: row.weightGrams.trim() === '' ? null : Number(row.weightGrams),
      imageUrl: row.imageUrl.trim() || null,
      isDefault: row.isDefault,
      isActive: row.isActive,
      sortOrder: index * 10,
      attributeValueIds: Object.values(row.selection).filter(Boolean),
      /*
       * Sent only for a row that is new. The API ignores it for a SKU it already
       * has — stock there belongs to the ledger — and sending it anyway would
       * read, to anyone looking at this payload, as an absolute stock write that
       * the endpoint quietly declines to perform.
       */
      ...(row.isNew ? { stockQuantity: row.stockQuantity.trim() === '' ? 0 : Number(row.stockQuantity) } : {}),
    }));

    try {
      await api.put(`/api/v1/admin/products/${productId}/variants`, { variants: payload });
      toast.success('Variants saved.');
      router.refresh();
    } catch (caught) {
      // The API reports a duplicate SKU under `variants`; anything per-field is
      // shown as one message rather than guessing which row it belongs to.
      const detail =
        caught instanceof ApiError && caught.details
          ? Object.values(caught.details).flat().join(' ')
          : '';
      setError(detail ? `${errorMessage(caught)} ${detail}` : errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Variants</CardTitle>
        <CardDescription>
          Each row is a separate thing to buy, with its own SKU, price and stock. A product with one variant is a
          simple product.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {options.length === 0 ? (
          <Alert variant="info">
            No variant attributes exist yet, so variants can only differ by SKU and price. Create one on the
            Attributes page to offer sizes or colours.
          </Alert>
        ) : null}

        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.key} className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="defaultVariant"
                      className="size-4"
                      checked={row.isDefault}
                      onChange={() => makeDefault(row.key)}
                      disabled={!canManage}
                    />
                    Default
                  </label>
                  {row.isDefault ? <Badge variant="info">Opens first</Badge> : null}
                  {!row.isActive ? <Badge variant="neutral">Hidden</Badge> : null}
                </div>

                {canManage ? (
                  <div className="flex items-center gap-1">
                    <label className="mr-2 flex items-center gap-2 text-sm">
                      <Switch
                        checked={row.isActive}
                        onCheckedChange={(checked) => patch(row.key, { isActive: checked })}
                      />
                      On sale
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => add(row)}
                      aria-label={`Duplicate variant ${index + 1}`}
                    >
                      <Copy aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(row.key)}
                      disabled={rows.length === 1}
                      aria-label={`Remove variant ${index + 1}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>

              {options.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {options.map((attribute) => (
                    <Field key={attribute.id} label={attribute.name} htmlFor={`${row.key}-${attribute.id}`}>
                      <select
                        id={`${row.key}-${attribute.id}`}
                        className={SELECT_CLASS}
                        value={row.selection[attribute.id] ?? ''}
                        onChange={(event) => choose(row.key, attribute.id, event.target.value)}
                        disabled={!canManage}
                      >
                        <option value="">Not set</option>
                        {attribute.values.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.value}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="SKU" htmlFor={`${row.key}-sku`} required hint="Unique across the whole store.">
                  <Input
                    id={`${row.key}-sku`}
                    value={row.sku}
                    onChange={(event) => patch(row.key, { sku: event.target.value })}
                    maxLength={64}
                    disabled={!canManage}
                  />
                </Field>
                {/*
                  One field, two meanings, decided by whether the variant exists
                  yet — see `Draft.isNew`. A new option (a 500 g line beside the
                  kilo) is given an opening balance here, with the `initial`
                  ledger row that records where its count started. An existing
                  one shows what is on the shelf and sends the owner to
                  Inventory, because every later movement is a signed adjustment
                  with a reason attached.
                */}
                {row.isNew ? (
                  <Field
                    label="Opening stock"
                    htmlFor={`${row.key}-stock`}
                    hint="How many of this one you have now."
                  >
                    <Input
                      id={`${row.key}-stock`}
                      inputMode="numeric"
                      value={row.stockQuantity}
                      onChange={(event) => patch(row.key, { stockQuantity: event.target.value })}
                      placeholder="0"
                      disabled={!canManage}
                    />
                  </Field>
                ) : (
                  <Field label="In stock" hint="Change it on the Inventory screen.">
                    <p className="flex h-10 items-center gap-2 text-sm">
                      {row.onShelf === null ? (
                        <span className="text-muted-foreground">Not counted</span>
                      ) : (
                        <span className="font-medium tabular-nums">{row.onShelf}</span>
                      )}
                      <Link
                        href={`/inventory?search=${encodeURIComponent(row.sku)}`}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Adjust
                      </Link>
                    </p>
                  </Field>
                )}

                <Field label="Label" htmlFor={`${row.key}-title`} hint='Shown in the basket — "Black / M".'>
                  <Input
                    id={`${row.key}-title`}
                    value={row.title}
                    onChange={(event) => patch(row.key, { title: event.target.value })}
                    maxLength={200}
                    disabled={!canManage}
                  />
                </Field>
                <Field label={`Price (${currency})`} htmlFor={`${row.key}-price`} required>
                  <Input
                    id={`${row.key}-price`}
                    inputMode="decimal"
                    value={row.price}
                    onChange={(event) => patch(row.key, { price: event.target.value })}
                    placeholder="19.99"
                    disabled={!canManage}
                  />
                </Field>
                <Field label={`Sale price (${currency})`} htmlFor={`${row.key}-salePrice`}>
                  <Input
                    id={`${row.key}-salePrice`}
                    inputMode="decimal"
                    value={row.salePrice}
                    onChange={(event) => patch(row.key, { salePrice: event.target.value })}
                    disabled={!canManage}
                  />
                </Field>

                {/*
                  Per variant, because the window is a column on the variant and
                  not on the product: one size can be on offer while the rest of
                  the range is not. Both bounds are read by `effectiveSale`, so a
                  sale outside its window charges full price on its own.
                */}
                <Field label="Sale starts" htmlFor={`${row.key}-saleStartsAt`} hint="Empty starts at once.">
                  <Input
                    id={`${row.key}-saleStartsAt`}
                    type="datetime-local"
                    value={row.saleStartsAt}
                    onChange={(event) => patch(row.key, { saleStartsAt: event.target.value })}
                    disabled={!canManage}
                  />
                </Field>

                <Field label="Sale ends" htmlFor={`${row.key}-saleEndsAt`} hint="Empty runs until cleared.">
                  <Input
                    id={`${row.key}-saleEndsAt`}
                    type="datetime-local"
                    value={row.saleEndsAt}
                    onChange={(event) => patch(row.key, { saleEndsAt: event.target.value })}
                    disabled={!canManage}
                  />
                </Field>
                <Field label={`Cost (${currency})`} htmlFor={`${row.key}-costPrice`} hint="Never shown to shoppers.">
                  <Input
                    id={`${row.key}-costPrice`}
                    inputMode="decimal"
                    value={row.costPrice}
                    onChange={(event) => patch(row.key, { costPrice: event.target.value })}
                    disabled={!canManage}
                  />
                </Field>
                <Field label="Barcode" htmlFor={`${row.key}-barcode`}>
                  <Input
                    id={`${row.key}-barcode`}
                    value={row.barcode}
                    onChange={(event) => patch(row.key, { barcode: event.target.value })}
                    maxLength={64}
                    disabled={!canManage}
                  />
                </Field>
                <Field label="Weight (g)" htmlFor={`${row.key}-weight`} hint="Used by weight-based shipping.">
                  <Input
                    id={`${row.key}-weight`}
                    inputMode="numeric"
                    value={row.weightGrams}
                    onChange={(event) => patch(row.key, { weightGrams: event.target.value })}
                    disabled={!canManage}
                  />
                </Field>
                <Field label="Image address" htmlFor={`${row.key}-image`} hint="Shown on the basket line.">
                  <Input
                    id={`${row.key}-image`}
                    value={row.imageUrl}
                    onChange={(event) => patch(row.key, { imageUrl: event.target.value })}
                    placeholder="https://…"
                    disabled={!canManage}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>

        {canManage ? (
          <>
            <p className="text-xs text-muted-foreground">
              Changing a SKU replaces the variant rather than renaming it, and its stock does not follow. Removing
              a row deletes that variant and its stock levels; past orders keep their own record.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => add()}>
                <Plus aria-hidden /> Add a variant
              </Button>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                onClick={save}
                loading={saving}
                disabled={rows.length === 0}
              >
                Save variants
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
