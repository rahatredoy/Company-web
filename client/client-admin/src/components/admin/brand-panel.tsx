'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import type { BrandRow } from '@/lib/types';
import { ImageUpload } from './image-upload';

/**
 * Add or edit one brand, in a panel beside the list — the same arrangement the
 * category screen uses, for the same reason: a brand is a handful of fields, and
 * a whole route for it would be more navigation than content.
 *
 * Controlled rather than read from `FormData`, because three fields count their
 * own characters and the slug follows the name until it is edited by hand.
 */

/** Soft limits: what the storefront and search engines actually use. */
const LIMITS = { description: 500, seoTitle: 60, seoDescription: 160 } as const;

interface Draft {
  name: string;
  slug: string;
  description: string;
  logoUrl: string;
  websiteUrl: string;
  isFeatured: boolean;
  sortOrder: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
}

function draftFrom(brand: BrandRow | null): Draft {
  return {
    name: brand?.name ?? '',
    slug: brand?.slug ?? '',
    description: brand?.description ?? '',
    logoUrl: brand?.logoUrl ?? '',
    websiteUrl: brand?.websiteUrl ?? '',
    isFeatured: brand?.isFeatured ?? false,
    sortOrder: String(brand?.sortOrder ?? 0),
    seoTitle: brand?.seoTitle ?? '',
    seoDescription: brand?.seoDescription ?? '',
    isActive: brand?.isActive ?? true,
  };
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn('text-[11px] tabular-nums', value > max ? 'text-warning' : 'text-muted-foreground')}>
      {value}/{max}
    </span>
  );
}

export function BrandPanel({
  open,
  onOpenChange,
  brand,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while adding. */
  brand: BrandRow | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(brand));
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Reset when pointed at a different brand, keyed off identity rather than an
  // effect on `open`, so reopening the same row keeps a value the API rejected and
  // the user is halfway through fixing.
  const identity = `${open ? 'open' : 'shut'}:${brand?.id ?? 'new'}`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setDraft(draftFrom(brand));
    setSlugTouched(Boolean(brand));
    setError('');
    setFieldErrors({});
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      logoUrl: draft.logoUrl.trim() || null,
      websiteUrl: draft.websiteUrl.trim() || null,
      isActive: draft.isActive,
      isFeatured: draft.isFeatured,
      sortOrder: Number(draft.sortOrder) || 0,
      seoTitle: draft.seoTitle.trim() || null,
      seoDescription: draft.seoDescription.trim() || null,
    };

    // Only sent when it is the thing being changed: the API re-derives a slug
    // whenever one arrives, and a live storefront URL that moves on an unrelated
    // save breaks every link pointing at it.
    const slug = draft.slug.trim();
    if (!brand) {
      if (slug) payload.slug = slug;
    } else if (slug !== brand.slug) {
      payload.slug = slug;
    }

    try {
      if (brand) await api.patch(`/api/v1/admin/brands/${brand.id}`, payload);
      else await api.post('/api/v1/admin/brands', payload);

      toast.success(brand ? 'Brand saved.' : 'Brand added.');
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

  const stepSort = (by: number) =>
    set('sortOrder', String(Math.max(0, Math.min(100_000, (Number(draft.sortOrder) || 0) + by))));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{brand ? 'Edit Brand' : 'Add Brand'}</SheetTitle>
            <SheetDescription>
              {brand
                ? 'Update brand details and settings.'
                : 'Brands are optional — a product does not need one.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            {/* Left is the brand as a shopper meets it; right is where it sits
                and how it is described to a search engine. */}
            <SheetColumns>
              <SheetColumn>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Brand Name" htmlFor="brand-name" required error={fieldErrors.name}>
                    <Input
                      id="brand-name"
                      value={draft.name}
                      onChange={(event) => {
                        set('name', event.target.value);
                        if (!slugTouched) set('slug', slugify(event.target.value));
                      }}
                      required
                      maxLength={140}
                      autoFocus
                    />
                  </Field>

                  <Field label="Slug" htmlFor="brand-slug" error={fieldErrors.slug}>
                    <Input
                      id="brand-slug"
                      value={draft.slug}
                      onChange={(event) => {
                        setSlugTouched(true);
                        set('slug', event.target.value);
                      }}
                      onBlur={(event) => set('slug', slugify(event.target.value))}
                      placeholder="made-from-the-name"
                      maxLength={160}
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>

                <Field label="Description" htmlFor="brand-description" error={fieldErrors.description}>
                  <div className="relative">
                    <Textarea
                      id="brand-description"
                      value={draft.description}
                      onChange={(event) => set('description', event.target.value)}
                      maxLength={LIMITS.description}
                      rows={3}
                      className="pb-7"
                      placeholder="Who they are, in a sentence."
                    />
                    <span className="absolute right-3 bottom-2">
                      <Counter value={draft.description.length} max={LIMITS.description} />
                    </span>
                  </div>
                </Field>

                <Field label="Logo" error={fieldErrors.logoUrl}>
                  <ImageUpload
                    name="logoUrl"
                    purpose="brands"
                    defaultValue={draft.logoUrl}
                    onChange={(url) => set('logoUrl', url)}
                    label="Change"
                  />
                </Field>

                <Field
                  label="Website"
                  htmlFor="brand-website"
                  hint="The maker’s own site. Shown on the brand page."
                  error={fieldErrors.websiteUrl}
                >
                  <Input
                    id="brand-website"
                    type="url"
                    value={draft.websiteUrl}
                    onChange={(event) => set('websiteUrl', event.target.value)}
                    placeholder="https://…"
                    maxLength={2000}
                  />
                </Field>
              </SheetColumn>

              <SheetColumn>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="brand-featured">Featured Brand</Label>
                  <Switch
                    id="brand-featured"
                    checked={draft.isFeatured}
                    onCheckedChange={(checked) => set('isFeatured', checked)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="brand-sort">Sort Order</Label>
                  <div className="relative w-32">
                    <Input
                      id="brand-sort"
                      type="number"
                      min={0}
                      max={100_000}
                      value={draft.sortOrder}
                      onChange={(event) => set('sortOrder', event.target.value)}
                      className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      aria-describedby="brand-sort-hint"
                    />
                    <span className="absolute inset-y-1 right-1 grid w-6 grid-rows-2 overflow-hidden rounded border border-border">
                      <button
                        type="button"
                        onClick={() => stepSort(1)}
                        aria-label="Increase sort order"
                        className="grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ChevronUp className="size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => stepSort(-1)}
                        aria-label="Decrease sort order"
                        className="grid place-items-center border-t border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ChevronDown className="size-3" aria-hidden />
                      </button>
                    </span>
                  </div>
                </div>
                <p id="brand-sort-hint" className="-mt-3 text-xs text-muted-foreground">
                  Lower numbers come first in the storefront’s brand list.
                </p>

                <Field label="SEO Title" htmlFor="brand-seo-title" error={fieldErrors.seoTitle}>
                  <div className="relative">
                    <Input
                      id="brand-seo-title"
                      value={draft.seoTitle}
                      onChange={(event) => set('seoTitle', event.target.value)}
                      maxLength={LIMITS.seoTitle}
                      className="pr-14"
                      placeholder={draft.name || 'Shown as the browser tab and search result title'}
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2">
                      <Counter value={draft.seoTitle.length} max={LIMITS.seoTitle} />
                    </span>
                  </div>
                </Field>

                <Field label="Meta Description" htmlFor="brand-seo-description" error={fieldErrors.seoDescription}>
                  <div className="relative">
                    <Textarea
                      id="brand-seo-description"
                      value={draft.seoDescription}
                      onChange={(event) => set('seoDescription', event.target.value)}
                      maxLength={LIMITS.seoDescription}
                      rows={3}
                      className="pb-7"
                      placeholder="The sentence search engines show under the title."
                    />
                    <span className="absolute right-3 bottom-2">
                      <Counter value={draft.seoDescription.length} max={LIMITS.seoDescription} />
                    </span>
                  </div>
                </Field>

                <Field label="Status" error={fieldErrors.isActive}>
                  <RadioGroup
                    value={draft.isActive ? 'active' : 'hidden'}
                    onValueChange={(value) => set('isActive', value === 'active')}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="active" id="brand-status-active" />
                      <Label htmlFor="brand-status-active" className="font-normal">
                        Active (Visible)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="hidden" id="brand-status-hidden" />
                      <Label htmlFor="brand-status-hidden" className="font-normal">
                        Hidden
                      </Label>
                    </div>
                  </RadioGroup>
                </Field>
              </SheetColumn>
            </SheetColumns>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {brand ? 'Save Brand' : 'Add Brand'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
