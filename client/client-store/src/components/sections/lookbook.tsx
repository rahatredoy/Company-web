import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { LookbookTile } from '@/types';
import { cn } from '@/lib/utils';

/**
 * The lookbook: a copy panel beside a row of styled photographs.
 *
 * Editorial rather than transactional — no prices, no add-to-cart. It exists to
 * make a case for a collection, and putting a price on it would turn it into a
 * worse product grid.
 *
 * On a phone the tiles become a horizontal scroller so the block stays one
 * screen tall instead of becoming four stacked photographs.
 */
export function Lookbook({
  title,
  subtitle,
  ctaLabel,
  ctaHref,
  tiles,
  className,
}: {
  title: string;
  subtitle?: string | null;
  /** Both or neither: a labelled button needs somewhere to go. */
  ctaLabel: string | null;
  ctaHref: string | null;
  tiles: LookbookTile[];
  className?: string;
}) {
  if (tiles.length === 0) return null;

  return (
    <div className={cn('grid gap-4 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,2fr)]', className)}>
      <div className="flex flex-col justify-center rounded-(--radius-card) bg-surface-alt p-6 sm:p-8">
        <h2 className="text-2xl font-semibold leading-tight sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}

        {ctaLabel && ctaHref ? (
          <Link
            href={ctaHref}
            className="mt-6 inline-flex w-fit items-center gap-2 rounded-(--radius-button) border border-border-strong bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
          >
            {ctaLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {tiles.slice(0, 4).map((tile) => {
          const media = (
            <>
              <Image
                src={tile.imageUrl}
                alt={tile.caption ?? ''}
                aria-hidden={tile.caption ? undefined : true}
                fill
                sizes="(min-width: 1024px) 18vw, (min-width: 640px) 33vw, 60vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              {tile.caption ? (
                <>
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent"
                  />
                  <span className="absolute inset-x-0 bottom-0 p-3 text-sm font-medium text-white">
                    {tile.caption}
                  </span>
                </>
              ) : null}
            </>
          );

          return (
            <li key={tile.id} className="w-52 shrink-0 snap-start sm:w-auto">
              {tile.linkUrl ? (
                <Link
                  href={tile.linkUrl}
                  className="group relative flex aspect-3/4 overflow-hidden rounded-(--radius-card) bg-surface-alt"
                >
                  {media}
                </Link>
              ) : (
                <div className="group relative flex aspect-3/4 overflow-hidden rounded-(--radius-card) bg-surface-alt">
                  {media}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
