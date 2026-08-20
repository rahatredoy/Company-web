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
import type { CategoryRow } from '@/lib/types';
import { ImageUpload } from './image-upload';
import { descendantIds, SELECT_CLASS } from './category-tree';

/**
 * Add or edit one category, in a panel beside the list rather than on a page of
 * its own.
 *
 * A category is small enough that a whole route would be more navigation than
 * content, and the tree is the context you need while editing one — which parent
 * a subcategory is going under is the whole point of the screen. The list stays
 * on screen and the panel closes back onto it.
 *
 * The form is controlled rather than read out of `FormData` because four fields
 * count their own characters, the slug follows the name until it is edited by
 * hand, and the parent select has to exclude the branch you are standing on.
 * None of that can be answered at submit time.
 */

/** Soft limits: what the storefront and search engines actually use. */
const LIMITS = { description: 500, seoTitle: 60, seoDescription: 160 } as const;

interface Draft {
  name: string;
  slug: string;
  parentId: string;
  description: string;
  imageUrl: string;
  iconUrl: string;
  bannerUrl: string;
  showInMenu: boolean;
  isFeatured: boolean;
  sortOrder: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
}

function draftFrom(category: CategoryRow | null, presetParentId: string | null): Draft {
  return {
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    parentId: category?.parentId ?? presetParentId ?? '',
    description: category?.description ?? '',
    imageUrl: category?.imageUrl ?? '',
    iconUrl: category?.iconUrl ?? '',
    bannerUrl: category?.bannerUrl ?? '',
    showInMenu: category?.showInMenu ?? true,
    isFeatured: category?.isFeatured ?? false,
    sortOrder: String(category?.sortOrder ?? 0),
    seoTitle: category?.seoTitle ?? '',
    seoDescription: category?.seoDescription ?? '',
    isActive: category?.isActive ?? true,
  };
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn('text-[11px] tabular-nums', value > max ? 'text-warning' : 'text-muted-foreground')}>
      {value}/{max}
    </span>
  );
}

export function CategoryPanel({
  open,
  onOpenChange,
  category,
  presetParentId = null,
  subcategory = false,
  all,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null while adding. */
  category: CategoryRow | null;
  /** Pre-selected parent, set when the row's menu said "Add subcategory". */
  presetParentId?: string | null;
  /** Opened by "Add Subcategory": a parent is required, not merely offered. */
  subcategory?: boolean;
  all: CategoryRow[];
  /** Passed the saved row's parent, so the list can open the branch it went into. */
  onSaved: (parentId: string | null) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(category, presetParentId));
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  /*
   * Three forms out of one component, and the parent field is the whole
   * difference between them.
   *
   *  - Add Category      — top level by definition, so it is never asked which
   *                        parent to use; there is no field at all.
   *  - Add Subcategory   — the parent is the point, so it is the first thing
   *                        asked and the form will not save without it.
   *  - Edit              — the category is already somewhere; the field stays
   *                        optional so it can be moved, top level included.
   */
  const asSubcategory = !category && (subcategory || Boolean(presetParentId));

  // Reset when the panel is pointed at a different category. Keyed off identity
  // rather than an effect on `open`, so reopening the same row does not discard
  // a value the API rejected and the user is halfway through fixing.
  const identity = `${open ? 'open' : 'shut'}:${category?.id ?? 'new'}:${presetParentId ?? ''}:${
    subcategory ? 'sub' : 'top'
  }`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setDraft(draftFrom(category, presetParentId));
    setSlugTouched(Boolean(category));
    setError('');
    setFieldErrors({});
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /*
   * A category cannot go inside itself or inside anything beneath it — that
   * makes a cycle the tree can never be walked out of. The API refuses it, and
   * the select does not offer it, so the refusal is never reached by accident.
   */
  const blocked = React.useMemo(() => {
    if (!category) return new Set<string>();
    const set = descendantIds(all, category.id);
    set.add(category.id);
    return set;
  }, [all, category]);

  const parentOptions = React.useMemo(
    () =>
      all
        .filter((row) => !blocked.has(row.id))
        .map((row) => ({ id: row.id, name: row.name, parentId: row.parentId }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [all, blocked],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setFieldErrors({});

    // Caught here rather than by the API, which has no way of knowing the panel
    // was opened as "Add Subcategory" — to it, a null parent is a top-level
    // category and perfectly valid.
    if (asSubcategory && !draft.parentId) {
      setFieldErrors({ parentId: 'Choose the category this one sits inside.' });
      setError('A subcategory needs a parent category.');
      return;
    }

    setBusy(true);

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      parentId: draft.parentId === '' ? null : draft.parentId,
      description: draft.description.trim() || null,
      imageUrl: draft.imageUrl.trim() || null,
      iconUrl: draft.iconUrl.trim() || null,
      bannerUrl: draft.bannerUrl.trim() || null,
      isActive: draft.isActive,
      showInMenu: draft.showInMenu,
      isFeatured: draft.isFeatured,
      sortOrder: Number(draft.sortOrder) || 0,
      seoTitle: draft.seoTitle.trim() || null,
      seoDescription: draft.seoDescription.trim() || null,
    };

    /*
     * The address is only sent when it is the thing being changed. The API
     * re-derives a slug whenever one arrives, and a live storefront URL that
     * moves on an unrelated save breaks every link pointing at it.
     */
    const slug = draft.slug.trim();
    if (!category) {
      if (slug) payload.slug = slug;
    } else if (slug !== category.slug) {
      payload.slug = slug;
    }

    try {
      if (category) await api.patch(`/api/v1/admin/categories/${category.id}`, payload);
      else await api.post('/api/v1/admin/categories', payload);

      toast.success(category ? 'Category saved.' : asSubcategory ? 'Subcategory added.' : 'Category added.');
      onOpenChange(false);
      onSaved((payload.parentId as string | null) ?? null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? '']),
          ),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const parentName = draft.parentId
    ? (all.find((row) => row.id === draft.parentId)?.name ?? null)
    : null;

  const stepSort = (by: number) =>
    set('sortOrder', String(Math.max(0, Math.min(100_000, (Number(draft.sortOrder) || 0) + by))));

  /*
   * Written once and placed twice: first in the subcategory form, where it is
   * the question being asked, and after the name in the edit form, where it is
   * one detail among the rest. The top-level form never renders it.
   */
  const parentField = (
    <Field
      label="Parent Category"
      htmlFor="cat-parent"
      required={asSubcategory}
      hint={
        asSubcategory
          ? 'The subcategory is listed inside this one on the storefront.'
          : 'Move it under another category, or leave it at the top level.'
      }
      error={fieldErrors.parentId}
    >
      <select
        id="cat-parent"
        value={draft.parentId}
        onChange={(event) => set('parentId', event.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{asSubcategory ? 'Select a parent category…' : 'None — top level'}</option>
        {parentOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>
              {category ? 'Edit Category' : asSubcategory ? 'Add Subcategory' : 'Add Category'}
            </SheetTitle>
            <SheetDescription>
              {category
                ? 'Update category details and settings.'
                : asSubcategory
                  ? parentName
                    ? `Listed inside ${parentName} on the storefront.`
                    : 'Pick the category this one goes inside.'
                  : 'A top-level category. Use Add Subcategory to put one inside another.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            {/* Left is what the category is; right is where it appears and how
                it is described to a search engine. */}
            <SheetColumns>
              <SheetColumn>
                {asSubcategory ? parentField : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={asSubcategory ? 'Subcategory Name' : 'Category Name'}
                    htmlFor="cat-name"
                    required
                    error={fieldErrors.name}
                  >
                    <Input
                      id="cat-name"
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

                  <Field label="Slug" htmlFor="cat-slug" required error={fieldErrors.slug}>
                    <Input
                      id="cat-slug"
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

                {category ? parentField : null}

                <Field label="Description" htmlFor="cat-description" error={fieldErrors.description}>
                  <div className="relative">
                    <Textarea
                      id="cat-description"
                      value={draft.description}
                      onChange={(event) => set('description', event.target.value)}
                      maxLength={LIMITS.description}
                      rows={3}
                      className="pb-7"
                      placeholder="What a shopper finds in here."
                    />
                    <span className="absolute right-3 bottom-2">
                      <Counter value={draft.description.length} max={LIMITS.description} />
                    </span>
                  </div>
                </Field>

                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <Field label="Category Image" error={fieldErrors.imageUrl}>
                    <ImageUpload
                      name="imageUrl"
                      purpose="categories"
                      defaultValue={draft.imageUrl}
                      onChange={(url) => set('imageUrl', url)}
                      label="Change"
                    />
                  </Field>

                  <Field label="Menu Icon" error={fieldErrors.iconUrl}>
                    <ImageUpload
                      name="iconUrl"
                      purpose="categories"
                      defaultValue={draft.iconUrl}
                      onChange={(url) => set('iconUrl', url)}
                      label="Change"
                      compact
                    />
                  </Field>
                </div>

                {/*
                  The wide artwork across the top of the category's own page.

                  Its own field rather than a second use of the image above: that
                  one is a tile in a grid and this is a masthead, so they are
                  different crops of different pictures. The column has always
                  been there and the API has always accepted it — the form simply
                  never asked, which left the banner unsettable from the panel.
                */}
                <Field
                  label="Page Banner"
                  hint="Shown across the top of this category's page."
                  error={fieldErrors.bannerUrl}
                >
                  <ImageUpload
                    name="bannerUrl"
                    purpose="categories"
                    defaultValue={draft.bannerUrl}
                    onChange={(url) => set('bannerUrl', url)}
                    label="Change"
                  />
                </Field>
              </SheetColumn>

              <SheetColumn>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="cat-menu">Show in Navigation</Label>
                  <Switch
                    id="cat-menu"
                    checked={draft.showInMenu}
                    onCheckedChange={(checked) => set('showInMenu', checked)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="cat-featured">Featured Category</Label>
                  <Switch
                    id="cat-featured"
                    checked={draft.isFeatured}
                    onCheckedChange={(checked) => set('isFeatured', checked)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="cat-sort">Sort Order</Label>
                  <div className="relative w-32">
                    <Input
                      id="cat-sort"
                      type="number"
                      min={0}
                      max={100_000}
                      value={draft.sortOrder}
                      onChange={(event) => set('sortOrder', event.target.value)}
                      className="pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      aria-describedby="cat-sort-hint"
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
                <p id="cat-sort-hint" className="-mt-3 text-xs text-muted-foreground">
                  Lower numbers come first among categories at the same level.
                </p>

                <Field label="SEO Title" htmlFor="cat-seo-title" error={fieldErrors.seoTitle}>
                  <div className="relative">
                    <Input
                      id="cat-seo-title"
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

                <Field label="Meta Description" htmlFor="cat-seo-description" error={fieldErrors.seoDescription}>
                  <div className="relative">
                    <Textarea
                      id="cat-seo-description"
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
                      <RadioGroupItem value="active" id="cat-status-active" />
                      <Label htmlFor="cat-status-active" className="font-normal">
                        Active (Visible)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="hidden" id="cat-status-hidden" />
                      <Label htmlFor="cat-status-hidden" className="font-normal">
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
              {category ? 'Save Category' : asSubcategory ? 'Add Subcategory' : 'Add Category'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
