'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BannerRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
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
import { ImageUpload } from '@/components/admin/image-upload';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

const POSITIONS: { value: BannerRow['position']; label: string; hint: string }[] = [
  { value: 'home_hero', label: 'Homepage hero', hint: 'The big one at the top.' },
  { value: 'home_promo', label: 'Homepage promo', hint: 'A strip further down.' },
  { value: 'category_top', label: 'Category page', hint: 'Above a category listing.' },
  { value: 'sidebar', label: 'Sidebar', hint: 'Beside a listing.' },
  { value: 'popup', label: 'Popup', hint: 'Over the page. Use sparingly.' },
];

/**
 * Banners.
 *
 * The image is a URL rather than an upload: there is no object-storage
 * configured on this platform yet, and a file picker that cannot store a file is
 * worse than a field that says what it needs. The preview below each row is the
 * real image, so a broken address is obvious immediately rather than after
 * somebody visits the shop.
 */
export function BannerManager({ rows, canManage }: { rows: BannerRow[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BannerRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

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

    const payload = {
      title: optional('title'),
      subtitle: optional('subtitle'),
      imageUrl: text('imageUrl'),
      mobileImageUrl: optional('mobileImageUrl'),
      linkUrl: optional('linkUrl'),
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
      toast.success('Banner saved.');
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
    if (!window.confirm(`Remove ${row.title ?? 'this banner'}?`)) return;

    try {
      await api.delete(`/api/v1/admin/banners/${row.id}`);
      toast.success('Banner removed.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const grouped = POSITIONS.map((position) => ({
    ...position,
    banners: rows.filter((row) => row.position === position.value),
  })).filter((group) => group.banners.length > 0);

  return (
    <>
      {canManage ? (
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> Add a banner
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No banners yet. Your homepage renders without them.
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => (
          <section key={group.value} className="space-y-3">
            <h2 className="text-sm font-semibold">
              {group.label}
              <span className="ml-2 font-normal text-muted-foreground">{group.hint}</span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              {group.banners.map((row) => (
                <Card key={row.id} className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.imageUrl}
                    alt={row.title ?? 'Banner'}
                    className="h-32 w-full bg-muted object-cover"
                  />
                  <CardContent className="space-y-2 pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.title ?? 'Untitled'}</p>
                        {row.subtitle ? (
                          <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>
                        ) : null}
                      </div>
                      {row.isActive ? null : <Badge variant="neutral">Off</Badge>}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {row.linkUrl ? `Links to ${row.linkUrl}` : 'No link'}
                      {row.endsAt ? ` · until ${formatDate(row.endsAt)}` : ''}
                    </p>

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
          </section>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit banner' : 'Add a banner'}</DialogTitle>
              <DialogDescription>
                Paste the address of an image you have already uploaded somewhere.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <Field label="Image" htmlFor="imageUrl" required error={fieldErrors.imageUrl}>
                <ImageUpload name="imageUrl" purpose="banners" defaultValue={editing?.imageUrl ?? ''} />
              </Field>

              <Field
                label="Phone image"
                htmlFor="mobileImageUrl"
                hint="Optional. A wide banner often crops badly on a phone."
              >
                <ImageUpload
                  name="mobileImageUrl"
                  purpose="banners"
                  defaultValue={editing?.mobileImageUrl ?? ''}
                  label="Upload a phone image"
                />
              </Field>

              <Field label="Where it appears" htmlFor="position">
                <select
                  id="position"
                  name="position"
                  defaultValue={editing?.position ?? 'home_hero'}
                  className={SELECT_CLASS}
                >
                  {POSITIONS.map((position) => (
                    <option key={position.value} value={position.value}>
                      {position.label} — {position.hint}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Heading" htmlFor="title">
                <Input id="title" name="title" defaultValue={editing?.title ?? ''} maxLength={160} />
              </Field>

              <Field label="Subheading" htmlFor="subtitle">
                <Input id="subtitle" name="subtitle" defaultValue={editing?.subtitle ?? ''} maxLength={240} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Links to" htmlFor="linkUrl" hint="A path like /sale.">
                  <Input id="linkUrl" name="linkUrl" defaultValue={editing?.linkUrl ?? ''} />
                </Field>
                <Field label="Button text" htmlFor="buttonLabel">
                  <Input id="buttonLabel" name="buttonLabel" defaultValue={editing?.buttonLabel ?? ''} maxLength={60} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts" htmlFor="startsAt">
                  <Input id="startsAt" name="startsAt" type="date" defaultValue={editing?.startsAt?.slice(0, 10) ?? ''} />
                </Field>
                <Field label="Ends" htmlFor="endsAt">
                  <Input id="endsAt" name="endsAt" type="date" defaultValue={editing?.endsAt?.slice(0, 10) ?? ''} />
                </Field>
              </div>

              <Field label="Order" htmlFor="sortOrder" hint="Lower shows first.">
                <Input id="sortOrder" name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} />
              </Field>

              <label className="flex items-center gap-3 text-sm">
                <Switch name="isActive" defaultChecked={editing?.isActive ?? true} />
                Show this banner
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save banner
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

