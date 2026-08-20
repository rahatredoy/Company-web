'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A thumbnail in a list row.
 *
 * `next/image` is not used here on purpose: these URLs are on the store's own R2
 * public domain, which is already behind a four-hour CDN `max-age`, and routing
 * them through the Next optimiser would move that work onto the panel's own
 * server for every store on one deployment — for an image rendered at 40px.
 *
 * Three things earn their place. `loading="lazy"` keeps a batch of twenty-five
 * rows from opening twenty-five connections before the reader has scrolled;
 * virtualisation already stops rows far down the list from existing, but the
 * rows in the first screenful are real and only some of them are visible.
 * `decoding="async"` keeps a large source off the main thread. And the box holds
 * its size from the first paint, so a row does not resize when its picture
 * arrives — which on a virtualised list would shift every row measured after it.
 */
export function LazyImage({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null | undefined;
  alt: string;
  /** Must carry the box's size — the placeholder and the image share it. */
  className?: string;
  /** Shown when there is no picture, or when the one there is fails to load. */
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  // A row can be reused for a different product as the list virtualises, so the
  // load state has to follow the source rather than the element. Adjusted during
  // render; an effect would show the previous row's picture for a frame.
  const [lastSrc, setLastSrc] = React.useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setFailed(false);
    setLoaded(false);
  }

  if (!src || failed) {
    return (
      <span className={cn('grid shrink-0 place-items-center overflow-hidden', className)} aria-hidden>
        {fallback}
      </span>
    );
  }

  return (
    <span className={cn('relative block shrink-0 overflow-hidden bg-muted', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          'size-full object-cover transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}
