'use client';

import * as React from 'react';
import { ImagePlus, Loader2, Upload, X } from 'lucide-react';
import { errorMessage, uploadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type UploadPurpose = 'products' | 'categories' | 'brands' | 'banners' | 'website';

/**
 * Picking a file, or pasting an address.
 *
 * Both, deliberately. Uploading is what most people want; pasting is what
 * somebody with an existing CDN, a stock photo library, or a file already on
 * the site needs — and it is also the escape hatch if storage is ever
 * unconfigured. The value the form submits is a URL either way, so nothing
 * downstream has to know which route it took. A form that wants only files
 * turns the address box off with `pasteable={false}`.
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
  label,
  compact = false,
  pasteable = true,
  onChange,
}: {
  name: string;
  purpose: UploadPurpose;
  defaultValue?: string;
  disabled?: boolean;
  /** The button's words. Defaults to "Upload an image"; shown as given otherwise. */
  label?: string;
  /** Preview beside the button instead of above it — for a small mark, not a photo. */
  compact?: boolean;
  /** Offer the "paste an address" box beside the upload. Off means a file or nothing. */
  pasteable?: boolean;
  /** For a parent holding the value in state rather than reading `FormData`. */
  onChange?: (url: string) => void;
}) {
  const t = useT();
  const [value, setValue] = React.useState(defaultValue);

  // A parent that owns the value needs to hear every route it can change by:
  // the upload, the remove button and the pasted address all funnel through here.
  const commit = (next: string) => {
    setValue(next);
    onChange?.(next);
  };
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      commit(await uploadFile(purpose, file));
    } catch (caught) {
      setError(errorMessage(caught, t('We could not reach the store. Try again.')));
    } finally {
      setUploading(false);
      // Let the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const box = compact ? 'size-14' : 'h-32 w-32';

  const preview = value ? (
    <div className="relative w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={value}
        alt=""
        className={cn(box, 'rounded-md border bg-muted object-cover')}
        onError={() => setError(t('That address does not load as an image.'))}
      />
      {!disabled ? (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className={cn('absolute rounded-full', compact ? '-top-2.5 -right-2.5 size-6' : '-top-2 -right-2')}
          onClick={() => commit('')}
          aria-label={t('Remove image')}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  ) : (
    <div
      className={cn(
        box,
        'grid place-items-center rounded-md border border-dashed text-muted-foreground',
        disabled && 'opacity-60',
      )}
    >
      <ImagePlus className={compact ? 'size-4' : 'size-6'} aria-hidden />
    </div>
  );

  const picker = (
    <>
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
        {uploading ? t('Uploading…') : (label ?? t('Upload an image'))}
      </Button>
    </>
  );

  return (
    <div className={cn(compact ? 'space-y-2' : 'space-y-3')}>
      <input type="hidden" name={name} value={value} />

      {compact ? (
        <div className="flex items-center gap-3">
          {preview}
          {picker}
        </div>
      ) : (
        <>
          {preview}
          <div className="flex flex-wrap items-center gap-2">
            {picker}
            {pasteable ? <span className="text-xs text-muted-foreground">{t('or paste an address')}</span> : null}
          </div>
        </>
      )}

      {pasteable ? (
        <Input
          value={value}
          onChange={(event) => commit(event.target.value)}
          // i18n-ignore
          placeholder="https://…"
          disabled={disabled || uploading}
          aria-label={t('Image address')}
          className={compact ? 'h-9 text-xs' : undefined}
        />
      ) : null}

      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
