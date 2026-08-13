'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ImageUpload } from '@/components/admin/image-upload';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { api, ApiError, errorMessage } from '@/lib/api';
import { toast } from '@/components/ui/toaster';
import type { BrandRow, CategoryRow, ProductDetail, ProductStatus } from '@/lib/types';

interface Props {
  categories: Pick<CategoryRow, 'id' | 'name'>[];
  brands: Pick<BrandRow, 'id' | 'name'>[];
  currency: string;
  /** Absent when creating. */
  product?: ProductDetail;
}

/**
 * One form for both creating and editing, because the fields are the same and
 * two copies would drift.
 *
 * A `simple` product and its single sellable variant are edited together here —
 * the API writes them in one transaction, so SKU and price sit alongside the
 * name rather than behind a second screen nobody would think to open.
 *
 * Field errors come from the API's `details` map rather than being re-derived in
 * the browser: the API is the only place the rules actually live, and a second
 * copy here would eventually disagree with it.
 */
export function ProductForm({ categories, brands, currency, product }: Props) {
  const router = useRouter();
  const editing = Boolean(product);

  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const variant = product?.defaultVariant;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(form.get(key) ?? '').trim();
      return value === '' ? null : value;
    };

    const payload = {
      name: String(form.get('name') ?? '').trim(),
      status: String(form.get('status') ?? 'draft') as ProductStatus,
      categoryId: text('categoryId'),
      brandId: text('brandId'),
      shortDescription: text('shortDescription'),
      description: text('description'),
      sku: String(form.get('sku') ?? '').trim(),
      price: String(form.get('price') ?? '').trim(),
      salePrice: text('salePrice'),
      costPrice: text('costPrice'),
      barcode: text('barcode'),
      imageUrl: text('imageUrl'),
      isFeatured: form.get('isFeatured') === 'on',
      isNewArrival: form.get('isNewArrival') === 'on',
      isReturnable: form.get('isReturnable') === 'on',
    };

    try {
      const saved = product
        ? await api.patch<ProductDetail>(`/api/v1/admin/products/${product.id}`, payload)
        : await api.post<ProductDetail>('/api/v1/admin/products', payload);

      toast.success(editing ? 'Product saved.' : 'Product created.');
      router.push(`/products/${saved.id}`);
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
  }

  async function remove() {
    if (!product) return;
    setDeleting(true);
    setError('');

    try {
      // A product that has sold is withdrawn rather than deleted, and the API
      // says which happened — repeating its own words avoids promising a
      // deletion that did not take place.
      const result = await api.delete<{ deleted: boolean; message?: string } | undefined>(
        `/api/v1/admin/products/${product.id}`,
      );

      if (result && result.deleted === false) {
        toast.success(result.message ?? 'Product hidden from the store.');
        router.refresh();
      } else {
        toast.success('Product deleted.');
        router.push('/products');
        router.refresh();
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Name" htmlFor="name" required error={fieldErrors.name}>
                <Input id="name" name="name" defaultValue={product?.name ?? ''} required maxLength={200} />
              </Field>

              <Field
                label="Short description"
                htmlFor="shortDescription"
                hint="One line, shown in listings and search results."
                error={fieldErrors.shortDescription}
              >
                <Input
                  id="shortDescription"
                  name="shortDescription"
                  defaultValue={product?.shortDescription ?? ''}
                  maxLength={500}
                />
              </Field>

              <Field label="Description" htmlFor="description" error={fieldErrors.description}>
                <textarea
                  id="description"
                  name="description"
                  rows={7}
                  defaultValue={product?.description ?? ''}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Price and stock code</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="SKU"
                htmlFor="sku"
                required
                hint="Unique across the whole store."
                error={fieldErrors.sku}
              >
                <Input id="sku" name="sku" defaultValue={variant?.sku ?? ''} required maxLength={64} />
              </Field>

              <Field label="Barcode" htmlFor="barcode" error={fieldErrors.barcode}>
                <Input id="barcode" name="barcode" defaultValue={variant?.barcode ?? ''} maxLength={64} />
              </Field>

              <Field label={`Price (${currency})`} htmlFor="price" required error={fieldErrors.price}>
                <Input
                  id="price"
                  name="price"
                  inputMode="decimal"
                  placeholder="19.99"
                  defaultValue={variant?.price ?? ''}
                  required
                />
              </Field>

              <Field
                label={`Sale price (${currency})`}
                htmlFor="salePrice"
                hint="Leave empty when it is not on sale."
                error={fieldErrors.salePrice}
              >
                <Input
                  id="salePrice"
                  name="salePrice"
                  inputMode="decimal"
                  defaultValue={variant?.salePrice ?? ''}
                />
              </Field>

              <Field
                label={`Cost price (${currency})`}
                htmlFor="costPrice"
                hint="Never shown to customers."
                error={fieldErrors.costPrice}
              >
                <Input
                  id="costPrice"
                  name="costPrice"
                  inputMode="decimal"
                  defaultValue={variant?.costPrice ?? ''}
                />
              </Field>

              <Field label="Image" htmlFor="imageUrl" error={fieldErrors.imageUrl}>
                <ImageUpload name="imageUrl" purpose="products" defaultValue={variant?.imageUrl ?? ''} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Status" htmlFor="status" error={fieldErrors.status}>
                {/* A plain select: the form is read with FormData, and the Radix
                    trigger is a button that contributes no value to it. */}
                <select
                  id="status"
                  name="status"
                  defaultValue={product?.status ?? 'draft'}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="draft">Draft — not on the storefront</option>
                  <option value="active">Active — on sale</option>
                  <option value="inactive">Inactive — hidden</option>
                </select>
              </Field>

              <Field label="Category" htmlFor="categoryId" error={fieldErrors.categoryId}>
                <select
                  id="categoryId"
                  name="categoryId"
                  defaultValue={product?.categoryId ?? ''}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Brand" htmlFor="brandId" error={fieldErrors.brandId}>
                <select
                  id="brandId"
                  name="brandId"
                  defaultValue={product?.brandId ?? ''}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="">No brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="isFeatured">Featured</Label>
                <Switch id="isFeatured" name="isFeatured" defaultChecked={product?.isFeatured ?? false} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="isNewArrival">New arrival</Label>
                <Switch id="isNewArrival" name="isNewArrival" defaultChecked={product?.isNewArrival ?? false} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="isReturnable">Returnable</Label>
                <Switch id="isReturnable" name="isReturnable" defaultChecked={product?.isReturnable ?? true} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/products">Cancel</Link>
          </Button>
        </div>

        {product ? (
          <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
            <Trash2 /> {deleting ? 'Working…' : 'Delete'}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
