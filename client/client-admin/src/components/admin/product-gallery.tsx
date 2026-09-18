'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { publicEnv } from '@/lib/env';
import type { ProductMediaRow } from '@/lib/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useT } from '@/lib/i18n';

const LIMIT = 12;

interface Draft {
  /** Local only — a stable React key that survives a reorder. */
  key: string;
  url: string;
  altText: string;
}

let counter = 0;
const nextKey = () => `media-${(counter += 1)}`;

/**
 * The product's gallery.
 *
 * Saved as one whole list rather than image by image, which is what the API
 * accepts and what makes a reorder a single request instead of N. It also means
 * the list on screen is exactly what will be stored — there is no half-applied
 * state where two of five moves went through.
 *
 * The single picture on the product form above is **not** one of these rows. It
 * belongs to the default variant and is the one flagged primary; the API keeps
 * the two apart so that saving a gallery never deletes the picture the listings
 * read. Order here is the order the storefront shows them in.
 */
export function ProductGallery({
  productId,
  media,
  canManage,
}: {
  productId: string;
  media: ProductMediaRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [rows, setRows] = React.useState<Draft[]>(() =>
    media.map((row) => ({ key: nextKey(), url: row.url, altText: row.altText ?? '' })),
  );
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState('');

  const patch = (key: string, change: Partial<Draft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const addBlank = () => setRows((current) => [...current, { key: nextKey(), url: '', altText: '' }]);

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    setError('');

    // Uploaded one at a time on purpose: the API checks size and type per file
    // and a rejected one should not take the rest of the selection with it.
    for (const file of files.slice(0, LIMIT - rows.length)) {
      const body = new FormData();
      body.append('file', file);

      try {
        const response = await fetch(`${publicEnv.apiUrl}/api/v1/admin/uploads?purpose=products`, {
          method: 'POST',
          body,
          credentials: 'include',
        });

        const payload = (await response.json().catch(() => null)) as
          | { data?: { url?: string }; message?: string }
          | null;

        if (!response.ok || !payload?.data?.url) {
          setError(payload?.message ?? t('{file} could not be uploaded.', { file: file.name }));
          continue;
        }

        const url = payload.data.url;
        setRows((current) => [...current, { key: nextKey(), url, altText: '' }]);
      } catch (caught) {
        setError(errorMessage(caught, t('We could not reach the store. Try again.')));
      }
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    setSaving(true);
    setError('');

    // A blank row is somebody who opened a slot and changed their mind, not an
    // image to be saved as an empty address the API would refuse.
    const payload = rows
      .filter((row) => row.url.trim() !== '')
      .map((row, index) => ({
        url: row.url.trim(),
        altText: row.altText.trim() || null,
        sortOrder: index * 10,
      }));

    try {
      await api.put(`/api/v1/admin/products/${productId}/media`, { media: payload });
      toast.success(payload.length === 0 ? t('Gallery cleared.') : t('Gallery saved.'));
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Gallery')}</CardTitle>
        <CardDescription>
          {t(
            'Extra pictures shown on the product page, in this order. Up to {limit}. The main image is set on the form above.',
            { limit: LIMIT },
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {rows.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground">
            <ImagePlus className="size-6" aria-hidden />
            {t('No gallery images yet.')}
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((row, index) => (
              <li key={row.key} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
                {row.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.url} alt="" className="size-16 shrink-0 rounded border bg-muted object-cover" />
                ) : (
                  <div className="grid size-16 shrink-0 place-items-center rounded border border-dashed text-muted-foreground">
                    <ImagePlus className="size-5" aria-hidden />
                  </div>
                )}

                <div className="min-w-[16rem] flex-1 space-y-2">
                  <Input
                    value={row.url}
                    onChange={(event) => patch(row.key, { url: event.target.value })}
                    // i18n-ignore — an address format, not language
                    placeholder="https://…"
                    aria-label={t('Image {number} address', { number: index + 1 })}
                    disabled={!canManage}
                  />
                  <Input
                    value={row.altText}
                    onChange={(event) => patch(row.key, { altText: event.target.value })}
                    placeholder={t('Describe the picture — read aloud by screen readers')}
                    maxLength={200}
                    aria-label={t('Image {number} description', { number: index + 1 })}
                    disabled={!canManage}
                  />
                </div>

                {canManage ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t('Move up')}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => move(index, 1)}
                      disabled={index === rows.length - 1}
                      aria-label={t('Move down')}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                      aria-label={t('Remove image')}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onPick}
              disabled={uploading || rows.length >= LIMIT}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || rows.length >= LIMIT}
            >
              {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {uploading ? t('Uploading…') : t('Upload images')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addBlank}
              disabled={rows.length >= LIMIT}
            >
              {t('Paste an address')}
            </Button>
            <Button type="button" size="sm" className="ml-auto" onClick={save} loading={saving}>
              {t('Save gallery')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
