'use client';

import * as React from 'react';
import { ImagePlus, Loader2, Upload, X } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type UploadPurpose = 'products' | 'categories' | 'brands' | 'banners' | 'website';

/**
 * Picking a file, or pasting an address.
 *
 * Both, deliberately. Uploading is what most people want; pasting is what
 * somebody with an existing CDN, a stock photo library, or a file already on
 * the site needs — and it is also the escape hatch if storage is ever
 * unconfigured. The value the form submits is a URL either way, so nothing
 * downstream has to know which route it took.
 *
 * The hidden input carries the value so the parent's plain `FormData` read keeps
 * working. This is a controlled field pretending to be an uncontrolled one, for
 * the same reason `product-form.tsx` avoids Radix `Select`: the forms here read
 * their values out of `FormData` on submit, and a component that contributes
 * nothing to it is a field that silently saves empty.
 */
export function ImageUpload({
  name,
  purpose,
  defaultValue = '',
  disabled = false,
  label = 'Upload an image',
}: {
  name: string;
  purpose: UploadPurpose;
  defaultValue?: string;
  disabled?: boolean;
  label?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    const body = new FormData();
    body.append('file', file);

    try {
      /*
       * `fetch` directly rather than the shared `api` client: that wrapper sets
       * a JSON content type, and a multipart body needs the browser to set its
       * own header so the boundary is included.
       */
      const response = await fetch(
        `${publicEnv.apiUrl}/api/v1/admin/uploads?purpose=${purpose}`,
        { method: 'POST', body, credentials: 'include' },
      );

      const payload = (await response.json().catch(() => null)) as
        | { data?: { url?: string }; message?: string }
        | null;

      if (!response.ok || !payload?.data?.url) {
        setError(payload?.message ?? 'That file could not be uploaded.');
        return;
      }

      setValue(payload.data.url);
    } catch (caught) {
      setError(errorMessage(caught, 'We could not reach the store. Try again.'));
    } finally {
      setUploading(false);
      // Let the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={value} />

      {value ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="h-32 w-32 rounded-md border bg-muted object-cover"
            onError={() => setError('That address does not load as an image.')}
          />
          {!disabled ? (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute -right-2 -top-2 rounded-full"
              onClick={() => setValue('')}
              aria-label="Remove image"
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            'grid h-32 w-32 place-items-center rounded-md border border-dashed text-muted-foreground',
            disabled && 'opacity-60',
          )}
        >
          <ImagePlus className="size-6" aria-hidden />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={disabled || uploading}
          onChange={onPick}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {uploading ? 'Uploading…' : label}
        </Button>
        <span className="text-xs text-muted-foreground">or paste an address</span>
      </div>

      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://…"
        disabled={disabled || uploading}
        aria-label="Image address"
      />

      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
