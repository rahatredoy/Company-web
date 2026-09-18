'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import type { BannerRow, CategoryRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogColumn,
  DialogColumns,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { ImageUpload } from '@/components/admin/image-upload';
import { BannerDetail } from './banner-detail';
import { useViewTarget } from '@/hooks/use-detail';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

/** A banner has one destination, so the form asks which kind it is first. */
type Destination = 'none' | 'category' | 'path';

const DESTINATIONS: { value: Destination; label: MessageKey }[] = [
  { value: 'none', label: 'Nowhere — it is just artwork' },
  { value: 'category', label: 'A category or subcategory' },
  { value: 'path', label: 'A page on your shop' },
];

const POSITIONS: { value: BannerRow['position']; label: MessageKey; hint: MessageKey }[] = [
  { value: 'home_hero', label: 'Homepage hero', hint: 'The big one at the top.' },
  { value: 'home_promo', label: 'Homepage promo', hint: 'A strip further down.' },
  { value: 'category_top', label: 'Category page', hint: 'Above a category listing.' },
  { value: 'sidebar', label: 'Sidebar', hint: 'Beside a listing.' },
  { value: 'popup', label: 'Popup', hint: 'Over the page. Use sparingly.' },
];

/**
 * What size the artwork has to be, in pixels.
 *
 * Every figure here is read off the storefront rather than picked to look tidy.
 * `client-store`'s `PromoBannerCard` fills its card with `object-cover` at a
 * fixed aspect per shape — `strip` is `aspect-3/1` on a phone and `aspect-5/1`
 * from 640px up, `panel` is `aspect-16/10` then `aspect-2/1`, and `wide` is
 * `aspect-16/9` at every width. So **the proportion is the number that
 * matters**: an image of any other shape is cropped from the centre to fill,
 * never letterboxed, and nothing on this screen would otherwise warn about it —
 * the row preview is a fixed `h-32` and looks perfectly fine either way.
 *
 * The widths are the largest a browser will ever ask for, so they are also the
 * point past which more pixels are bytes every visitor pays for and none of them
 * sees. The homepage container is 80rem with 2rem of padding — 1216px of content
 * at most — and `client-store/next.config.ts` caps `deviceSizes` at 1920, so a
 * full-width banner is never served wider than that however large the file is.
 *
 * Which shape a banner runs at is the **homepage block's** setting and not this
 * screen's (`homepage_sections.config.ratio`/`columns`), which is why all three
 * are listed rather than one being derived from the placement above. Both of the
 * blocks a new store is seeded with are strips — so that is the one marked as
 * usual.
 */
const SHAPES: {
  label: MessageKey;
  note: MessageKey;
  image: string;
  imageRatio: string;
  phone: string;
  phoneRatio: string;
}[] = [
  {
    label: 'One wide strip',
    note: 'The usual one: the advertising break between two rows of products.',
    image: '1920 × 384',
    imageRatio: '5 : 1',
    phone: '1440 × 480',
    phoneRatio: '3 : 1',
  },
  {
    label: 'One large panel',
    note: 'Full width and deep, the way a hero is.',
    image: '1920 × 1080',
    imageRatio: '16 : 9',
    phone: '1440 × 810',
    phoneRatio: '16 : 9',
  },
  {
    label: 'Two side by side, or three across',
    note: 'Each one stacks to full width on a phone.',
    image: '1200 × 600',
    imageRatio: '2 : 1',
    phone: '1440 × 900',
    phoneRatio: '16 : 10',
  },
];

/**
 * The sizes, beside the uploads.
 *
 * Not in a help page and not in a tooltip: the question is asked while a file is
 * being chosen, and an answer that arrives after the banner has been saved and
 * looked at in the shop has arrived too late to be any use.
 *
 * It sits under both pickers and above the wording, so the panel reads as the
 * pictures, then the sizes those pictures should be, then the words that go on
 * them.
 */
function BannerSizeGuide() {
  const t = useT();

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs">
      <p className="font-medium text-foreground">{t('What size should the image be?')}</p>
      <p className="mt-1 text-muted-foreground">
        {t(
          'The shape is set by the homepage block this banner appears in. Your homepage’s banner blocks are wide strips.',
        )}
      </p>

      <table className="mt-3 w-full text-left">
        <thead className="text-muted-foreground">
          <tr>
            <th className="pb-1 pr-3 font-medium">{t('Shape')}</th>
            <th className="pb-1 pr-3 font-medium">{t('Image')}</th>
            <th className="pb-1 font-medium">{t('Phone image')}</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {SHAPES.map((shape) => (
            <tr key={shape.label} className="border-t border-border/60">
              <td className="py-1.5 pr-3">
                <span className="font-medium text-foreground">{t(shape.label)}</span>
                <span className="block text-muted-foreground">{t(shape.note)}</span>
              </td>
              <td className="py-1.5 pr-3 tabular-nums">
                <span className="whitespace-nowrap font-medium text-foreground">{shape.image} px</span>
                <span className="block whitespace-nowrap text-muted-foreground">{shape.imageRatio}</span>
              </td>
              <td className="py-1.5 tabular-nums">
                <span className="whitespace-nowrap font-medium text-foreground">{shape.phone} px</span>
                <span className="block whitespace-nowrap text-muted-foreground">{shape.phoneRatio}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-3 space-y-1 text-muted-foreground">
        <li>
          {t(
            'The proportion matters more than the exact pixels — any other shape is cropped from the centre to fill, so keep wording, faces and prices away from the edges.',
          )}
        </li>
        <li>
          {t(
            'A strip is shallower on a wide screen than on a phone, so the same artwork loses its left and right edges on a phone. Keep the message in the middle.',
          )}
        </li>
        <li>{t('JPG or WebP for photographs, PNG for flat colour. 10 MB is the limit; aim under 500 KB.')}</li>
      </ul>
    </div>
  );
}

/**
 * Where a banner goes when it is clicked.
 *
 * Three modes rather than two fields, because a banner has exactly one
 * destination and offering a category picker *and* a URL box side by side makes
 * the owner guess which one wins when both are filled in. Only the controls for
 * the chosen mode are rendered, so `FormData` carries only the answer that was
 * actually given — see `onSubmit`.
 *
 * The category half is the same two-select shape as the product form's, and for
 * the same reason: one list of every node would run to hundreds of entries with
 * the subcategories indented by whitespace nobody can scan. Only the deeper of
 * the two is submitted — a subcategory names itself, and its parent is implied.
 *
 * Remounted per banner (`key` on the caller) so a picker opened on the next row
 * reads that row's destination rather than keeping the last one's.
 */
function DestinationPicker({
  banner,
  categories,
  fieldError,
}: {
  banner: BannerRow | null;
  categories: Pick<CategoryRow, 'id' | 'name' | 'parentId'>[];
  fieldError?: string;
}) {
  const t = useT();
  const stored = categories.find((row) => row.id === banner?.categoryId);

  const [mode, setMode] = React.useState<Destination>(
    banner?.categoryId ? 'category' : banner?.linkUrl ? 'path' : 'none',
  );
  const [parentId, setParentId] = React.useState(stored?.parentId ?? stored?.id ?? '');
  const [childId, setChildId] = React.useState(stored?.parentId ? stored.id : '');

  const parents = React.useMemo(
    () => categories.filter((row) => !row.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  const children = React.useMemo(
    () => categories.filter((row) => row.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [categories, parentId],
  );

  return (
    <>
      <Field label={t('Where it goes')} htmlFor="destination" error={fieldError}>
        <select
          id="destination"
          name="destination"
          value={mode}
          onChange={(event) => setMode(event.target.value as Destination)}
          className={SELECT_CLASS}
        >
          {DESTINATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </Field>

      {mode === 'category' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('Category')}
            htmlFor="categoryId"
            hint={parents.length === 0 ? t('You have no categories yet.') : undefined}
          >
            <select
              id="categoryId"
              name="categoryId"
              value={parentId}
              onChange={(event) => {
                setParentId(event.target.value);
                // The old subcategory belongs to the old parent; keeping it
                // would send the banner to a branch this category has not got.
                setChildId('');
              }}
              className={SELECT_CLASS}
            >
              <option value="">{t('Choose a category')}</option>
              {parents.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t('Subcategory')}
            htmlFor="subcategoryId"
            hint={parentId && children.length === 0 ? t('This category has no subcategories.') : undefined}
          >
            <select
              id="subcategoryId"
              name="subcategoryId"
              value={childId}
              onChange={(event) => setChildId(event.target.value)}
              disabled={children.length === 0}
              className={SELECT_CLASS}
            >
              <option value="">{parentId ? t('The whole category') : t('Choose a category first')}</option>
              {children.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}

      {mode === 'path' ? (
        <Field
          label={t('Address')}
          htmlFor="linkUrl"
          hint={t('A path on your own shop, like /sale. Must start with a slash.')}
        >
          {/* i18n-ignore */}
          <Input id="linkUrl" name="linkUrl" defaultValue={banner?.linkUrl ?? ''} placeholder="/sale" />
        </Field>
      ) : null}
    </>
  );
}

/**
 * Banners.
 *
 * The artwork is uploaded or pasted — `ImageUpload` offers both, and the field
 * submits a URL either way, so a store with its own CDN or a stock library needs
 * no upload at all. The preview above each row is the real image, so a broken
 * address is obvious here rather than after somebody visits the shop.
 *
 * What that preview cannot show is the crop: it is a fixed `h-32` while the
 * storefront fills a fixed *aspect* per shape, so artwork of the wrong
 * proportion looks correct on this screen and loses its edges in the shop.
 * `BannerSizeGuide` is in the dialog for exactly that reason.
 */
export function BannerManager({
  rows,
  categories,
  canManage,
  storefrontBase,
}: {
  rows: BannerRow[];
  /** Needs `parentId`: the destination picker asks for the two levels separately. */
  categories: Pick<CategoryRow, 'id' | 'name' | 'parentId'>[];
  canManage: boolean;
  /** Null when the store's public address is not known to this deployment. */
  storefrontBase: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BannerRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  /*
   * The read-only panel. The card shows the desktop artwork; this shows both,
   * and a missing phone image is exactly the sort of thing a desktop preview
   * cannot tell you about.
   */
  const viewing = useViewTarget<BannerRow>();

  const openFor = (row: BannerRow | null) => {
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
    const optional = (name: string) => text(name) || null;

    /*
     * One destination, from whichever half of the picker was on screen. The
     * unchosen fields are not merely ignored — they are sent as null, so
     * switching a banner from a category to a path clears the category rather
     * than leaving a stale one behind to outrank the new address.
     */
    const destination = text('destination');
    const category = destination === 'category' ? optional('subcategoryId') ?? optional('categoryId') : null;

    const payload = {
      title: optional('title'),
      subtitle: optional('subtitle'),
      imageUrl: text('imageUrl'),
      mobileImageUrl: optional('mobileImageUrl'),
      linkUrl: destination === 'path' ? optional('linkUrl') : null,
      categoryId: category,
      buttonLabel: optional('buttonLabel'),
      position: text('position'),
      startsAt: optional('startsAt'),
      endsAt: optional('endsAt'),
      isActive: data.get('isActive') === 'on',
      sortOrder: Number(data.get('sortOrder') ?? 0),
    };

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      if (editing) await api.put(`/api/v1/admin/banners/${editing.id}`, payload);
      else await api.post('/api/v1/admin/banners', payload);

      setOpen(false);
      toast.success(t('Banner saved.'));
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

  const remove = async (row: BannerRow) => {
    const question =
      row.title === null ? t('Remove this banner?') : t('Remove {title}?', { title: row.title });
    if (!window.confirm(question)) return;

    try {
      await api.delete(`/api/v1/admin/banners/${row.id}`);
      toast.success(t('Banner removed.'));
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  /** What the card says the banner does, in the words the picker offered. */
  const destinationOf = (row: BannerRow) => {
    if (row.categoryId) {
      const category = categories.find((entry) => entry.id === row.categoryId);
      return category ? t('Opens {destination}', { destination: category.name }) : t('Opens a category');
    }
    return row.linkUrl ? t('Opens {destination}', { destination: row.linkUrl }) : t('Not clickable');
  };

  const grouped = POSITIONS.map((position) => ({
    ...position,
    banners: rows.filter((row) => row.position === position.value),
  })).filter((group) => group.banners.length > 0);

  return (
    <>
      {canManage ? (
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> {t('Add a banner')}
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('No banners yet. Your homepage renders without them.')}
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => (
          <section key={group.value} className="space-y-3">
            <h2 className="text-sm font-semibold">
              {t(group.label)}
              <span className="ml-2 font-normal text-muted-foreground">{t(group.hint)}</span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              {group.banners.map((row) => (
                <Card key={row.id} className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.imageUrl}
                    alt={row.title ?? t('Banner')}
                    className="h-32 w-full bg-muted object-cover"
                  />
                  <CardContent className="space-y-2 pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.title ?? t('Untitled')}</p>
                        {row.subtitle ? (
                          <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>
                        ) : null}
                      </div>
                      {row.isActive ? null : <Badge variant="neutral">{t('Off')}</Badge>}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {destinationOf(row)}
                      {row.endsAt ? ` · ${t('until {date}', { date: t.date(row.endsAt) })}` : ''}
                    </p>

                    <div className="flex gap-1 pt-1">
                      <Button variant="ghost" size="sm" onClick={() => viewing.view(row)}>
                        <Eye aria-hidden /> {t('View')}
                      </Button>
                      {canManage ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openFor(row)}>
                            <Pencil aria-hidden /> {t('Edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                            <Trash2 aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? t('Edit banner') : t('Add a banner')}</DialogTitle>
              <DialogDescription>
                {t('Upload the artwork or paste its address, say where it goes, and set the dates it runs.')}
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* The pictures and the words on them down the left, where it goes
                  and when it runs down the right — the two uploads are the tall
                  half, so keeping them together is what balances the columns. */}
              <DialogColumns>
                <DialogColumn>
                  <Field
                    label={t('Image')}
                    htmlFor="imageUrl"
                    required
                    hint={t('1920 × 384 px for a wide strip. Every shape is listed below.')}
                    error={fieldErrors.imageUrl}
                  >
                    <ImageUpload name="imageUrl" purpose="banners" defaultValue={editing?.imageUrl ?? ''} />
                  </Field>

                  <Field
                    label={t('Phone image')}
                    htmlFor="mobileImageUrl"
                    hint={t('Optional, and stored for later — today’s templates use the image above at every width.')}
                  >
                    <ImageUpload
                      name="mobileImageUrl"
                      purpose="banners"
                      defaultValue={editing?.mobileImageUrl ?? ''}
                      label={t('Upload a phone image')}
                    />
                  </Field>

                  <BannerSizeGuide />

                  <Field label={t('Heading')} htmlFor="title">
                    <Input id="title" name="title" defaultValue={editing?.title ?? ''} maxLength={160} />
                  </Field>

                  <Field label={t('Subheading')} htmlFor="subtitle">
                    <Input id="subtitle" name="subtitle" defaultValue={editing?.subtitle ?? ''} maxLength={240} />
                  </Field>
                </DialogColumn>

                <DialogColumn>
                  <Field label={t('Where it appears')} htmlFor="position">
                    <select
                      id="position"
                      name="position"
                      defaultValue={editing?.position ?? 'home_hero'}
                      className={SELECT_CLASS}
                    >
                      {POSITIONS.map((position) => (
                        <option key={position.value} value={position.value}>
                          {t(position.label)} — {t(position.hint)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <DestinationPicker
                    key={editing?.id ?? 'new'}
                    banner={editing}
                    categories={categories}
                    fieldError={fieldErrors.categoryId ?? fieldErrors.linkUrl}
                  />

                  <Field
                    label={t('Button text')}
                    htmlFor="buttonLabel"
                    hint={t('Only shown when the banner goes somewhere.')}
                  >
                    <Input
                      id="buttonLabel"
                      name="buttonLabel"
                      defaultValue={editing?.buttonLabel ?? ''}
                      maxLength={60}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('Starts')} htmlFor="startsAt">
                      <Input
                        id="startsAt"
                        name="startsAt"
                        type="date"
                        defaultValue={editing?.startsAt?.slice(0, 10) ?? ''}
                      />
                    </Field>
                    <Field label={t('Ends')} htmlFor="endsAt">
                      <Input id="endsAt" name="endsAt" type="date" defaultValue={editing?.endsAt?.slice(0, 10) ?? ''} />
                    </Field>
                  </div>

                  <Field label={t('Order::sort')} htmlFor="sortOrder" hint={t('Lower shows first.')}>
                    <Input id="sortOrder" name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} />
                  </Field>

                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isActive" defaultChecked={editing?.isActive ?? true} />
                    {t('Show this banner')}
                  </label>
                </DialogColumn>
              </DialogColumns>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" loading={saving}>
                {t('Save banner')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <BannerDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        storefrontBase={storefrontBase}
      />
    </>
  );
}
