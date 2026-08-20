'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
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
import { isoFromLocalInput, localInputValue } from '@/lib/local-datetime';
import type { BrandRow, CategoryRow, ProductRow, ProductStatus } from '@/lib/types';
import { ImageUpload } from './image-upload';
import { SELECT_CLASS } from './category-tree';

/**
 * The fields an owner changes between one glance at the list and the next —
 * the money, the stock codes, status, where it files, its picture — in a panel
 * beside the list rather than a round trip through the full editor.
 *
 * Everything here comes off the list row that is already on screen, which is why
 * it opens with no fetch. That is also the bound on what it can hold: the
 * description and the four list-shaped tabs are not in a list batch and belong
 * to the editor.
 *
 * It deliberately stops short of the editor's other four tabs. Variants, gallery,
 * specifications and the related-products bundle are each written as a **whole
 * list**, so they cannot share a Save with anything else: a rejected variant
 * would otherwise take an unrelated gallery edit down with it. What is here is
 * exactly what `PATCH /products/:id` accepts in one call, and the footer links to
 * the editor for the rest.
 */

interface Draft {
  name: string;
  slug: string;
  status: ProductStatus;
  categoryId: string;
  brandId: string;
  sku: string;
  barcode: string;
  price: string;
  salePrice: string;
  /** Local-clock strings for the two `datetime-local` boxes; '' means no bound. */
  saleStartsAt: string;
  saleEndsAt: string;
  costPrice: string;
  imageUrl: string;
  isFeatured: boolean;
  isNewArrival: boolean;
}

function draftFrom(product: ProductRow): Draft {
  return {
    name: product.name,
    slug: product.slug,
    status: product.status,
    categoryId: product.categoryId ?? '',
    brandId: product.brandId ?? '',
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    price: product.priceFrom ?? '',
    salePrice: product.salePriceFrom ?? '',
    saleStartsAt: localInputValue(product.saleStartsAt),
    saleEndsAt: localInputValue(product.saleEndsAt),
    costPrice: product.costPrice ?? '',
    imageUrl: product.imageUrl ?? '',
    isFeatured: product.isFeatured,
    isNewArrival: product.isNewArrival,
  };
}

export function ProductQuickEdit({
  open,
  onOpenChange,
  product,
  categories,
  brands,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while the panel is closed; the sheet keeps nothing between products. */
  product: ProductRow | null;
  categories: Pick<CategoryRow, 'id' | 'name'>[];
  brands: Pick<BrandRow, 'id' | 'name'>[];
  currency: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft | null>(product ? draftFrom(product) : null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Reset when pointed at a different product, keyed off identity rather than an
  // effect on `open` — reopening the same row keeps a value the API rejected and
  // the user is halfway through fixing.
  const identity = `${open ? 'open' : 'shut'}:${product?.id ?? 'none'}`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setDraft(product ? draftFrom(product) : null);
    setError('');
    setFieldErrors({});
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !draft) return;

    setBusy(true);
    setError('');
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      status: draft.status,
      categoryId: draft.categoryId === '' ? null : draft.categoryId,
      brandId: draft.brandId === '' ? null : draft.brandId,
      sku: draft.sku.trim(),
      barcode: draft.barcode.trim() || null,
      price: draft.price.trim(),
      salePrice: draft.salePrice.trim() || null,
      /*
       * Sent whether or not they were touched, which is right here: the panel
       * renders both boxes seeded from the row, so an empty one is the owner
       * saying "no bound" rather than the form having no opinion.
       */
      saleStartsAt: isoFromLocalInput(draft.saleStartsAt),
      saleEndsAt: isoFromLocalInput(draft.saleEndsAt),
      costPrice: draft.costPrice.trim() || null,
      imageUrl: draft.imageUrl.trim() || null,
      isFeatured: draft.isFeatured,
      isNewArrival: draft.isNewArrival,
    };

    // The address is only sent when it is the thing being changed: the API
    // re-derives a slug whenever one arrives, and a live storefront URL that
    // moves on an unrelated save breaks every link pointing at it.
    const slug = draft.slug.trim();
    if (slug && slug !== product.slug) payload.slug = slug;

    try {
      await api.patch(`/api/v1/admin/products/${product.id}`, payload);
      toast.success('Product saved.');
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
        {product && draft ? (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <SheetHeader>
              <SheetTitle>Quick Edit</SheetTitle>
              <SheetDescription>
                Money, stock codes and where it files. The full editor has the description,
                variants, gallery, specifications and SEO.
              </SheetDescription>
            </SheetHeader>

            <SheetBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* What it is called and what it costs on the left; where it
                  files and how it is shown on the right. */}
              <SheetColumns>
                <SheetColumn>
                  <Field label="Product Name" htmlFor="qe-name" required error={fieldErrors.name}>
                    <Input
                      id="qe-name"
                      value={draft.name}
                      onChange={(event) => set('name', event.target.value)}
                      required
                      maxLength={200}
                      autoFocus
                    />
                  </Field>

                  <Field
                    label="Slug"
                    htmlFor="qe-slug"
                    hint="The storefront address. Changing it breaks existing links."
                    error={fieldErrors.slug}
                  >
                    <Input
                      id="qe-slug"
                      value={draft.slug}
                      onChange={(event) => set('slug', event.target.value)}
                      maxLength={220}
                      className="font-mono text-xs"
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Status" htmlFor="qe-status" error={fieldErrors.status}>
                      <select
                        id="qe-status"
                        value={draft.status}
                        onChange={(event) => set('status', event.target.value as ProductStatus)}
                        className={SELECT_CLASS}
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </Field>

                    <Field label="SKU" htmlFor="qe-sku" required error={fieldErrors.sku}>
                      <Input
                        id="qe-sku"
                        value={draft.sku}
                        onChange={(event) => set('sku', event.target.value)}
                        required
                        maxLength={64}
                        className="font-mono text-xs"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={`Price (${currency})`} htmlFor="qe-price" required error={fieldErrors.price}>
                      <Input
                        id="qe-price"
                        value={draft.price}
                        onChange={(event) => set('price', event.target.value)}
                        inputMode="decimal"
                        placeholder="19.99"
                        required
                      />
                    </Field>

                    <Field
                      label={`Sale Price (${currency})`}
                      htmlFor="qe-sale"
                      hint="Empty when not on sale."
                      error={fieldErrors.salePrice}
                    >
                      <Input
                        id="qe-sale"
                        value={draft.salePrice}
                        onChange={(event) => set('salePrice', event.target.value)}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>

                  {/*
                    When the sale price applies.

                    The storefront and checkout both price through
                    `effectiveSale`, which ignores a sale price outside its
                    window — so a sale that has not started charges full price
                    and an expired one ends itself. Without these boxes every
                    sale was permanent from the moment its price was typed, and
                    ending one meant remembering to come back and clear it.
                  */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Sale Starts"
                      htmlFor="qe-sale-starts"
                      hint="Empty starts it at once."
                      error={fieldErrors.saleStartsAt}
                    >
                      <Input
                        id="qe-sale-starts"
                        type="datetime-local"
                        value={draft.saleStartsAt}
                        onChange={(event) => set('saleStartsAt', event.target.value)}
                      />
                    </Field>

                    <Field
                      label="Sale Ends"
                      htmlFor="qe-sale-ends"
                      hint="Empty runs until cleared."
                      error={fieldErrors.saleEndsAt}
                    >
                      <Input
                        id="qe-sale-ends"
                        type="datetime-local"
                        value={draft.saleEndsAt}
                        onChange={(event) => set('saleEndsAt', event.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={`Cost Price (${currency})`}
                      htmlFor="qe-cost"
                      hint="Never shown to a shopper."
                      error={fieldErrors.costPrice}
                    >
                      <Input
                        id="qe-cost"
                        value={draft.costPrice}
                        onChange={(event) => set('costPrice', event.target.value)}
                        inputMode="decimal"
                      />
                    </Field>

                    <Field label="Barcode" htmlFor="qe-barcode" error={fieldErrors.barcode}>
                      <Input
                        id="qe-barcode"
                        value={draft.barcode}
                        onChange={(event) => set('barcode', event.target.value)}
                        maxLength={64}
                        className="font-mono text-xs"
                      />
                    </Field>
                  </div>
                </SheetColumn>

                <SheetColumn>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Category" htmlFor="qe-category" error={fieldErrors.categoryId}>
                      <select
                        id="qe-category"
                        value={draft.categoryId}
                        onChange={(event) => set('categoryId', event.target.value)}
                        className={SELECT_CLASS}
                      >
                        <option value="">No category</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Brand" htmlFor="qe-brand" error={fieldErrors.brandId}>
                      <select
                        id="qe-brand"
                        value={draft.brandId}
                        onChange={(event) => set('brandId', event.target.value)}
                        className={SELECT_CLASS}
                      >
                        <option value="">No brand</option>
                        {brands.map((brand) => (
                          <option key={brand.id} value={brand.id}>
                            {brand.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <Field
                    label="Main Image"
                    hint={
                      product.variantCount > 1
                        ? 'This is the default variant’s picture. Each variant can have its own in the editor.'
                        : undefined
                    }
                    error={fieldErrors.imageUrl}
                  >
                    <ImageUpload
                      name="imageUrl"
                      purpose="products"
                      defaultValue={draft.imageUrl}
                      onChange={(url) => set('imageUrl', url)}
                      label="Change"
                    />
                  </Field>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="qe-featured">Featured Product</Label>
                    <Switch
                      id="qe-featured"
                      checked={draft.isFeatured}
                      onCheckedChange={(checked) => set('isFeatured', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="qe-new">New Arrival</Label>
                    <Switch
                      id="qe-new"
                      checked={draft.isNewArrival}
                      onCheckedChange={(checked) => set('isNewArrival', checked)}
                    />
                  </div>

                  <Button asChild variant="outline" className="w-full">
                    <Link href={`/products/${product.id}`}>
                      Open full editor <ArrowUpRight />
                    </Link>
                  </Button>
                </SheetColumn>
              </SheetColumns>
            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save Product
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
