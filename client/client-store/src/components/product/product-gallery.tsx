'use client';

import * as React from 'react';
import Image from 'next/image';
import { Expand, X } from 'lucide-react';
import type { ProductImage } from '@/types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Carousel,
  CarouselDots,
  CarouselItem,
  CarouselViewport,
} from '@/components/carousel/carousel';
import { cn } from '@/lib/utils';

/**
 * Product gallery: thumbnails, a main image, hover zoom and a fullscreen view.
 *
 * Two layouts in one component. On a phone it is a swipeable rail with dots,
 * because a thumbnail strip on a 390px screen leaves no room for the picture.
 * From `sm` up it is a thumbnail column beside a large frame.
 *
 * Zoom is `transform: scale` driven by pointer position, not a second larger
 * image — the source is already 1000px and downloading a 2000px variant to
 * magnify a 500px frame costs more than it shows.
 */
export function ProductGallery({
  images,
  productName,
  /** Set when a variant with its own photograph is selected. */
  activeImageUrl,
}: {
  images: ProductImage[];
  productName: string;
  activeImageUrl?: string | null;
}) {
  const [index, setIndex] = React.useState(0);
  const [zoomed, setZoomed] = React.useState(false);
  const [origin, setOrigin] = React.useState('50% 50%');
  const [fullscreen, setFullscreen] = React.useState(false);

  // A variant image wins over the gallery selection: choosing "Navy" and still
  // seeing the black one is the single most confusing thing a gallery can do.
  const variantIndex = activeImageUrl
    ? images.findIndex((image) => image.url === activeImageUrl)
    : -1;
  const current = images[variantIndex >= 0 ? variantIndex : Math.min(index, images.length - 1)];

  if (images.length === 0) {
    return (
      <div className="product-media grid place-items-center text-sm text-subtle">No image</div>
    );
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    setOrigin(`${x}% ${y}%`);
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
      {/* Thumbnails: a column beside the frame on desktop, hidden on mobile
          where the frame itself is swipeable. */}
      {images.length > 1 ? (
        <ul className="hidden shrink-0 flex-col gap-2 sm:flex">
          {images.map((image, position) => {
            const active = position === (variantIndex >= 0 ? variantIndex : index);
            return (
              <li key={image.url}>
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-label={`View image ${position + 1} of ${images.length}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative block size-16 overflow-hidden rounded-(--radius-button) border-2 transition-colors lg:size-20',
                    active ? 'border-primary' : 'border-transparent hover:border-border-strong',
                  )}
                >
                  <Image
                    src={image.url}
                    alt=""
                    aria-hidden
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="min-w-0 flex-1">
        {/* Desktop frame with zoom. */}
        <div className="relative hidden sm:block">
          <div
            className="product-media cursor-zoom-in"
            onPointerEnter={() => setZoomed(true)}
            onPointerLeave={() => setZoomed(false)}
            onPointerMove={onPointerMove}
          >
            <Image
              src={current!.url}
              alt={current!.altText ?? productName}
              fill
              priority
              sizes="(min-width: 1024px) 45vw, 90vw"
              className={cn('object-cover transition-transform duration-200', zoomed && 'scale-150')}
              style={{ transformOrigin: origin }}
            />
          </div>

          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label="View image full screen"
            className="absolute bottom-3 right-3 grid size-10 place-items-center rounded-full bg-surface/90 text-foreground shadow-[var(--shadow-card)] transition-colors hover:text-primary"
          >
            <Expand className="size-4" aria-hidden />
          </button>
        </div>

        {/* Mobile: a real swipe rail, so the gesture is the browser's own. */}
        <div className="sm:hidden">
          <Carousel label={`${productName} images`} loop={false}>
            <CarouselViewport gap="gap-2" snap="center">
              {images.map((image, position) => (
                <CarouselItem key={image.url} snap="center" className="w-full">
                  <div className="product-media">
                    <Image
                      src={image.url}
                      alt={image.altText ?? `${productName}, view ${position + 1}`}
                      fill
                      priority={position === 0}
                      sizes="100vw"
                      className="object-cover"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselViewport>
            <CarouselDots className="mt-3" />
          </Carousel>
        </div>
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent
          showClose={false}
          className="max-w-[min(96vw,72rem)] bg-transparent p-0 shadow-none"
        >
          <DialogTitle className="sr-only">{productName}</DialogTitle>

          <div className="relative aspect-square w-full overflow-hidden rounded-(--radius-card) bg-surface">
            <Image
              src={current!.url}
              alt={current!.altText ?? productName}
              fill
              sizes="96vw"
              className="object-contain"
            />
          </div>

          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="Close"
            className="absolute -top-12 right-0 grid size-10 place-items-center rounded-full bg-surface text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
