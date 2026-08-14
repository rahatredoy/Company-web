import Image from 'next/image';
import type { GalleryTile } from '@/types';
import { cn } from '@/lib/utils';

/**
 * The shop's own social photography, as a row of squares.
 *
 * Not a lookbook and not a product grid: no prices, no add-to-cart, and the
 * tiles link *out* rather than in. It is the one block on the homepage whose
 * job is to show the shop existing somewhere other than the shop.
 *
 * Squares because that is the aspect every social platform crops to, so a photo
 * pulled from a feed arrives already composed for this shape — a 4:5 tile would
 * re-crop someone's framing.
 *
 * On a phone the row scrolls sideways rather than wrapping to three rows of
 * two, which would push the footer a screen and a half further down.
 */
export function SocialGallery({
  tiles,
  handle,
  className,
}: {
  tiles: GalleryTile[];
  /** e.g. `@shopmart` — rendered as a caption, never as a link target. */
  handle?: string | null;
  className?: string;
}) {
  if (tiles.length === 0) return null;

  return (
    <div className={className}>
      {handle ? <p className="mb-4 text-center text-sm text-muted">{handle}</p> : null}

      <ul className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {tiles.slice(0, 6).map((tile) => {
          const media = (
            <>
              <Image
                src={tile.imageUrl}
                alt={tile.caption ?? ''}
                aria-hidden={tile.caption ? undefined : true}
                fill
                sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 40vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              {tile.caption ? (
                <>
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-linear-to-t from-black/55 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                  />
                  <span className="absolute inset-x-0 bottom-0 p-2 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {tile.caption}
                  </span>
                </>
              ) : null}
            </>
          );

          const shell = 'group relative flex aspect-square overflow-hidden rounded-(--radius-card) bg-surface-alt';

          return (
            <li key={tile.id} className="w-36 shrink-0 snap-start sm:w-auto">
              {tile.linkUrl ? (
                /*
                 * `noopener` on every outbound `target="_blank"`: without it the
                 * opened page can reach back through `window.opener`.
                 */
                <a href={tile.linkUrl} target="_blank" rel="noreferrer noopener" className={cn(shell)}>
                  {media}
                </a>
              ) : (
                <div className={cn(shell)}>{media}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
