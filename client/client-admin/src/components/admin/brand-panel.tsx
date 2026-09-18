'use client';

import * as React from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetBody,
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
import type { BrandRow } from '@/lib/types';
import { ImageUpload } from './image-upload';

/**
 * Add or edit one brand, in a panel beside the list — the same arrangement the
 * category screen uses, for the same reason: a brand is a handful of fields, and
 * a whole route for it would be more navigation than content.
 *
 * Controlled rather than read from `FormData`, because the description counts
 * its own characters and the slug follows the name until it is edited by hand.
 *
 * Deliberately short: website, sort order and the two SEO fields are not asked.
 * Order is set by dragging rows in the list, and an edit never sends the other
 * three, so whatever is stored in them survives a save.
 */

/** Soft limits: what the storefront and search engines actually use. */
const LIMITS = { description: 500 } as const;

interface Draft {
  name: string;
  slug: string;
  description: string;
  logoUrl: string;
  isFeatured: boolean;
  isActive: boolean;
}

function draftFrom(brand: BrandRow | null): Draft {
  return {
    name: brand?.name ?? '',
    slug: brand?.slug ?? '',
    description: brand?.description ?? '',
    logoUrl: brand?.logoUrl ?? '',
    isFeatured: brand?.isFeatured ?? false,
    isActive: brand?.isActive ?? true,
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
  const t = useT();
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
      isActive: draft.isActive,
      isFeatured: draft.isFeatured,
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

      toast.success(brand ? t('Brand saved.') : t('Brand added.'));
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
      <SheetContent size="sm">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{brand ? t('Edit Brand') : t('Add Brand')}</SheetTitle>
            <SheetDescription>
              {brand
                ? t('Update brand details and settings.')
                : t('Brands are optional — a product does not need one.')}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Brand Name')} htmlFor="brand-name" required error={fieldErrors.name}>
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

              <Field label={t('Slug')} htmlFor="brand-slug" error={fieldErrors.slug}>
                <Input
                  id="brand-slug"
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

            <Field label={t('Description')} htmlFor="brand-description" error={fieldErrors.description}>
              <div className="relative">
                <Textarea
                  id="brand-description"
                  value={draft.description}
                  onChange={(event) => set('description', event.target.value)}
                  maxLength={LIMITS.description}
                  rows={3}
                  className="pb-7"
                  placeholder={t('Who they are, in a sentence.')}
                />
                <span className="absolute right-3 bottom-2">
                  <Counter value={draft.description.length} max={LIMITS.description} />
                </span>
              </div>
            </Field>

            <Field label={t('Logo')} error={fieldErrors.logoUrl}>
              <ImageUpload
                name="logoUrl"
                purpose="brands"
                defaultValue={draft.logoUrl}
                pasteable={false}
                onChange={(url) => set('logoUrl', url)}
                label={t('Change')}
              />
            </Field>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="brand-featured">{t('Featured Brand')}</Label>
              <Switch
                id="brand-featured"
                checked={draft.isFeatured}
                onCheckedChange={(checked) => set('isFeatured', checked)}
              />
            </div>

            <Field label={t('Status')} error={fieldErrors.isActive}>
              <RadioGroup
                value={draft.isActive ? 'active' : 'hidden'}
                onValueChange={(value) => set('isActive', value === 'active')}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="active" id="brand-status-active" />
                  <Label htmlFor="brand-status-active" className="font-normal">
                    {t('Active (Visible)')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="hidden" id="brand-status-hidden" />
                  <Label htmlFor="brand-status-hidden" className="font-normal">
                    {t('Hidden')}
                  </Label>
                </div>
              </RadioGroup>
            </Field>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {brand ? t('Save Brand') : t('Add Brand')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
