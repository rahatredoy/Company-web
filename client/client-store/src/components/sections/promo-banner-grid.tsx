import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { PromoBanner } from '@/types';
import { cn } from '@/lib/utils';

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

export function PromoBannerGrid({
  banners,
  columns,
  ratio = 'wide',
  className,
}: {
  banners: PromoBanner[];
  /** Defaults to one column per banner, capped at three. */
  columns?: 1 | 2 | 3;
  ratio?: 'wide' | 'panel' | 'tall';
  className?: string;
}) {
  if (banners.length === 0) return null;

  const cols = columns ?? (Math.min(banners.length, 3) as 1 | 2 | 3);

  return (
    <ul
      className={cn(
        'grid gap-4',
        cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        cols === 2 && 'sm:grid-cols-2',
        className,
      )}
    >
      {banners.map((banner) => (
        <li key={banner.id}>
          <PromoBannerCard banner={banner} ratio={ratio} />
        </li>
      ))}
    </ul>
  );
}

export function PromoBannerCard({
  banner,
  ratio = 'wide',
  className,
}: {
  banner: PromoBanner;
  ratio?: 'wide' | 'panel' | 'tall';
  className?: string;
}) {
  const tinted = isTinted(banner);
  const href = banner.linkUrl ?? '/shop';
  const onDark = banner.tone === 'dark' || banner.tone === 'primary';

  return (
    <Link
      href={href}
      className={cn(
        'group relative flex overflow-hidden rounded-(--radius-card)',
        ratio === 'wide' && 'aspect-16/9',
        ratio === 'panel' && 'aspect-16/10 sm:aspect-2/1',
        ratio === 'tall' && 'aspect-4/5',
        tinted ? TONES[banner.tone] : 'bg-surface-alt',
        className,
      )}
    >
      {banner.imageUrl ? (
        <>
          <Image
            src={banner.imageUrl}
            alt=""
            aria-hidden
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-linear-to-r from-black/65 via-black/25 to-transparent"
          />
        </>
      ) : null}

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

        {banner.buttonLabel ? (
          <span className="mt-3 inline-flex w-fit items-center gap-1 text-sm font-semibold underline-offset-4 group-hover:underline">
            {banner.buttonLabel}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
