'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { PromoBanner } from '@/types';
import { cn } from '@/lib/utils';
import { BannerRotationDots, useBannerRotation } from './banner-rotation';

/**
 * Campaign banners: one wide, two side by side, or a row of three.
 *
 * A banner may carry a photograph, a colour wash, or both. The tinted variants
 * are how the reference designs build a promo row with no product photography
 * at all — type on a pale panel, which stays sharp at any density and costs no
 * bytes.
 *
 * Destinations are validated to be internal by the config parser, so a banner
 * cannot become an outbound redirect on the store's own homepage.
 *
 * More banners than columns is not a mistake and is no longer truncated: the
 * row shows one full set at a time and swaps it every ten seconds. See
 * `useBannerRotation`.
 */

const TONES: Record<PromoBanner['tone'], string> = {
  none: 'bg-surface-alt',
  primary: 'bg-primary text-primary-foreground',
  peach: 'bg-[color-mix(in_oklab,var(--sale)_14%,white)]',
  mint: 'bg-[color-mix(in_oklab,var(--success)_12%,white)]',
  sky: 'bg-[color-mix(in_oklab,var(--accent)_20%,white)]',
  sand: 'bg-[color-mix(in_oklab,var(--accent)_16%,white)]',
  dark: 'bg-secondary text-secondary-foreground',
};

/** Tinted cards keep their own text colour; photographic ones go white on a scrim. */
const isTinted = (banner: PromoBanner) => banner.tone !== 'none' && !banner.imageUrl;

/**
 * Whether a banner has anything to say over its artwork.
 *
 * A campaign banner is usually a picture with the offer already set into it —
 * the artwork *is* the message. Laying a scrim and an empty text column over one
 * of those darkens a third of it to protect words that are not there, which is
 * how a perfectly good advert arrives looking like a rendering fault.
 */
const hasCopy = (banner: PromoBanner) =>
  Boolean(banner.eyebrow || banner.title || banner.subtitle || banner.couponCode || banner.buttonLabel);

export type BannerRatio = 'wide' | 'panel' | 'tall' | 'strip';

/**
 * What fraction of the viewport one card actually occupies.
 *
 * Told to the browser rather than guessed at. A full-width strip handed the
 * three-up hint downloads a third of the pixels it needs and renders soft; a
 * three-up card handed the full-width hint downloads three times what it can
 * show. Both are invisible in development, where the image is cached already and
 * the screen is wide.
 */
const SIZES: Record<1 | 2 | 3, string> = {
  1: '100vw',
  2: '(min-width: 640px) 50vw, 100vw',
  3: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
};

export function PromoBannerGrid({
  banners,
  columns,
  ratio = 'wide',
  className,
}: {
  banners: PromoBanner[];
  /** Defaults to one column per banner, capped at three. */
  columns?: 1 | 2 | 3;
  ratio?: BannerRatio;
  className?: string;
}) {
  const cols = columns ?? (Math.min(Math.max(banners.length, 1), 3) as 1 | 2 | 3);
  const { visible, page, pages, select, pauseProps, frameClassName } = useBannerRotation(
    banners,
    cols,
  );

  // After the hook, not before it: an early return above a hook is the one way
  // to break the rules of hooks that a store with no banners would trigger.
  if (banners.length === 0) return null;

  return (
    <div className={className} {...pauseProps}>
      <ul
        className={cn(
          'grid gap-4',
          cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
          cols === 2 && 'sm:grid-cols-2',
        )}
      >
        {visible.map((banner) => (
          // The page is part of the key so a swapped-in banner mounts fresh and
          // plays the fade rather than mutating the card that was already there.
          <li key={`${page}-${banner.id}`} className={frameClassName}>
            <PromoBannerCard banner={banner} ratio={ratio} sizes={SIZES[cols]} />
          </li>
        ))}
      </ul>

      <BannerRotationDots pages={pages} page={page} onSelect={select} className="mt-4" />
    </div>
  );
}

export function PromoBannerCard({
  banner,
  ratio = 'wide',
  sizes = SIZES[3],
  className,
}: {
  banner: PromoBanner;
  ratio?: BannerRatio;
  /** The artwork's `sizes` hint; `PromoBannerGrid` derives it per column count. */
  sizes?: string;
  className?: string;
}) {
  const tinted = isTinted(banner);
  const onDark = banner.tone === 'dark' || banner.tone === 'primary';
  /*
   * A picture with nothing written over it is shown whole — no scrim, and no
   * empty text column holding a third of the card open. A banner with no
   * artwork at all is nothing *but* its copy, so it keeps the panel either way.
   */
  const overlaid = hasCopy(banner) || !banner.imageUrl;

  const shell = cn(
    'group relative flex overflow-hidden rounded-(--radius-card)',
    ratio === 'wide' && 'aspect-16/9',
    ratio === 'panel' && 'aspect-16/10 sm:aspect-2/1',
    ratio === 'tall' && 'aspect-4/5',
    // The advertising strip between two rows of products. Shallow enough to
    // read as a break in the page rather than as a screen of its own, and
    // shallower still on a wide one, where a 16/9 band would push the next row
    // of products off the bottom entirely.
    ratio === 'strip' && 'aspect-3/1 sm:aspect-5/1',
    tinted ? TONES[banner.tone] : 'bg-surface-alt',
    className,
  );

  const body = (
    <>
      {banner.imageUrl ? (
        <>
          {/* Decorative while there is copy over it to carry the meaning; the
              only thing on the card when there is not, so it says what it is. */}
          <Image
            src={banner.imageUrl}
            alt={overlaid ? '' : (banner.title ?? banner.subtitle ?? '')}
            aria-hidden={overlaid || undefined}
            fill
            sizes={sizes}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {overlaid ? (
            <span
              aria-hidden
              className="absolute inset-0 bg-linear-to-r from-black/65 via-black/25 to-transparent"
            />
          ) : null}
        </>
      ) : null}

      {overlaid ? (
      <span
        className={cn(
          'relative flex w-full max-w-[22rem] flex-col justify-center p-5 sm:p-6',
          banner.imageUrl ? 'text-white' : onDark ? '' : 'text-foreground',
        )}
      >
        {banner.eyebrow ? (
          <span
            className={cn(
              'mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]',
              banner.imageUrl ? 'text-white/80' : onDark ? 'opacity-80' : 'text-primary',
            )}
          >
            {banner.eyebrow}
          </span>
        ) : null}

        {banner.title ? (
          <span className="text-lg font-bold leading-tight sm:text-2xl">{banner.title}</span>
        ) : null}

        {banner.subtitle ? (
          <span
            className={cn(
              'mt-1 text-sm',
              banner.imageUrl ? 'text-white/85' : onDark ? 'opacity-80' : 'text-muted',
            )}
          >
            {banner.subtitle}
          </span>
        ) : null}

        {banner.couponCode ? (
          <span
            className={cn(
              'mt-3 inline-flex w-fit items-center gap-1.5 rounded-(--radius-button) px-2.5 py-1.5 text-xs font-semibold',
              banner.imageUrl || onDark ? 'bg-white/15 text-current' : 'bg-surface text-foreground',
            )}
          >
            <span className="opacity-70">Use Code:</span>
            <span className="font-mono tracking-wide">{banner.couponCode}</span>
          </span>
        ) : null}

        {/* A call to action needs somewhere to call to. */}
        {banner.buttonLabel && banner.linkUrl ? (
          <span className="mt-3 inline-flex w-fit items-center gap-1 text-sm font-semibold underline-offset-4 group-hover:underline">
            {banner.buttonLabel}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        ) : null}
      </span>
      ) : null}
    </>
  );

  /*
   * A banner with no destination is not a link.
   *
   * It used to fall back to `/shop`, which meant a store that had left the URL
   * blank shipped a banner that looked clickable, was clickable, and took the
   * customer somewhere it had never named. An announcement with nothing behind
   * it should sit there being an announcement.
   */
  return banner.linkUrl ? (
    <Link href={banner.linkUrl} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
