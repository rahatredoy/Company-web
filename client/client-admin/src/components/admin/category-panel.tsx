'use client';

import * as React from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { useT } from '@/lib/i18n';
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
 * The form is controlled rather than read out of `FormData` because the SEO
 * title counts its own characters, the slug follows the name until it is
 * edited by hand, and the parent select has to exclude the branch you are
 * standing on. None of that can be answered at submit time.
 *
 * A category carries one picture and it is uploaded, never pasted: an address
 * typed here is a hotlink to somebody else's server, which breaks the day they
 * move the file and is served from outside the store's own storage.
 *
 * Two things are deliberately not asked. Position: a new category is placed
 * after its siblings by the API, and dragging a row in the list is how it moves.
 * And a meta description: the columns still exist and the API still takes them,
 * but they are not a question worth putting to someone adding an aisle.
 */

/** Soft limit: what search engines actually show. */
const LIMITS = { seoTitle: 60 } as const;

interface Draft {
  name: string;
  slug: string;
  parentId: string;
  imageUrl: string;
  showInMenu: boolean;
  isFeatured: boolean;
  seoTitle: string;
  isActive: boolean;
}

function draftFrom(category: CategoryRow | null, presetParentId: string | null): Draft {
  return {
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    parentId: category?.parentId ?? presetParentId ?? '',
    imageUrl: category?.imageUrl ?? '',
    showInMenu: category?.showInMenu ?? true,
    isFeatured: category?.isFeatured ?? false,
    seoTitle: category?.seoTitle ?? '',
    isActive: category?.isActive ?? true,
  };
}

function Counter({ value, max }: { value: number; max: number }) {
  const t = useT();
  return (
    <span className={cn('text-[10.5px] tabular-nums', value > max ? 'text-warning' : 'text-muted-foreground')}>
      {t.number(value)}/{t.number(max)}
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
  const t = useT();
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
      setFieldErrors({ parentId: t('Choose the category this one sits inside.') });
      setError(t('A subcategory needs a parent category.'));
      return;
    }

    setBusy(true);

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      parentId: draft.parentId === '' ? null : draft.parentId,
      imageUrl: draft.imageUrl.trim() || null,
      isActive: draft.isActive,
      showInMenu: draft.showInMenu,
      isFeatured: draft.isFeatured,
      seoTitle: draft.seoTitle.trim() || null,
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

      toast.success(
        category ? t('Category saved.') : asSubcategory ? t('Subcategory added.') : t('Category added.'),
      );
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

  /*
   * Written once and placed twice: first in the subcategory form, where it is
   * the question being asked, and after the name in the edit form, where it is
   * one detail among the rest. The top-level form never renders it.
   */
  const parentField = (
    <Field
      label={t('Parent Category')}
      htmlFor="cat-parent"
      required={asSubcategory}
      hint={
        asSubcategory
          ? t('The subcategory is listed inside this one on the storefront.')
          : t('Move it under another category, or leave it at the top level.')
      }
      error={fieldErrors.parentId}
    >
      <select
        id="cat-parent"
        value={draft.parentId}
        onChange={(event) => set('parentId', event.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{asSubcategory ? t('Select a parent category…') : t('None — top level')}</option>
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
              {category ? t('Edit Category') : asSubcategory ? t('Add Subcategory') : t('Add Category')}
            </SheetTitle>
            <SheetDescription>
              {category
                ? t('Update category details and settings.')
                : asSubcategory
                  ? parentName
                    ? t('Listed inside {name} on the storefront.', { name: parentName })
                    : t('Pick the category this one goes inside.')
                  : t('A top-level category. Use Add Subcategory to put one inside another.')}
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
                    label={asSubcategory ? t('Subcategory Name') : t('Category Name')}
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

                  <Field label={t('Slug')} htmlFor="cat-slug" required error={fieldErrors.slug}>
                    <Input
                      id="cat-slug"
                      value={draft.slug}
                      onChange={(event) => {
                        setSlugTouched(true);
                        set('slug', event.target.value);
                      }}
                      onBlur={(event) => set('slug', slugify(event.target.value))}
                      placeholder={t('made-from-the-name')}
                      maxLength={160}
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>

                {category ? parentField : null}

                <Field label={t('Category Image')} error={fieldErrors.imageUrl}>
                  <ImageUpload
                    name="imageUrl"
                    purpose="categories"
                    defaultValue={draft.imageUrl}
                    onChange={(url) => set('imageUrl', url)}
                    label={draft.imageUrl ? t('Change') : t('Upload')}
                    pasteable={false}
                  />
                </Field>
              </SheetColumn>

              <SheetColumn>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="cat-menu">{t('Show in Navigation')}</Label>
                  <Switch
                    id="cat-menu"
                    checked={draft.showInMenu}
                    onCheckedChange={(checked) => set('showInMenu', checked)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="cat-featured">{t('Featured Category')}</Label>
                  <Switch
                    id="cat-featured"
                    checked={draft.isFeatured}
                    onCheckedChange={(checked) => set('isFeatured', checked)}
                  />
                </div>

                <Field label={t('SEO Title')} htmlFor="cat-seo-title" error={fieldErrors.seoTitle}>
                  <div className="relative">
                    <Input
                      id="cat-seo-title"
                      value={draft.seoTitle}
                      onChange={(event) => set('seoTitle', event.target.value)}
                      maxLength={LIMITS.seoTitle}
                      className="pr-14"
                      placeholder={draft.name || t('Shown as the browser tab and search result title')}
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2">
                      <Counter value={draft.seoTitle.length} max={LIMITS.seoTitle} />
                    </span>
                  </div>
                </Field>

                <Field label={t('Status')} error={fieldErrors.isActive}>
                  <RadioGroup
                    value={draft.isActive ? 'active' : 'hidden'}
                    onValueChange={(value) => set('isActive', value === 'active')}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="active" id="cat-status-active" />
                      <Label htmlFor="cat-status-active" className="font-normal">
                        {t('Active (Visible)')}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="hidden" id="cat-status-hidden" />
                      <Label htmlFor="cat-status-hidden" className="font-normal">
                        {t('Hidden')}
                      </Label>
                    </div>
                  </RadioGroup>
                </Field>
              </SheetColumn>
            </SheetColumns>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {category ? t('Save Category') : asSubcategory ? t('Add Subcategory') : t('Add Category')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
