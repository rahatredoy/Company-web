import Image from 'next/image';
import Link from 'next/link';
import type { Category } from '@/types';
import { cn } from '@/lib/utils';

/**
 * The category rail — square tiles under the hero.
 *
 * The tiles were circles and are squares now: a circle crops a product picture
 * from four sides at once, which is what a category image almost always is, and
 * the corners it throws away are where the thing being sold usually sits. The
 * radius is the theme's own `--radius-card`, so the tile matches the product
 * cards below it rather than introducing a shape nothing else on the page uses
 * — and a theme that asks for square corners gets square corners here too.
 *
 * The component and its `category_circle` section type keep their names: that
 * key is stored in every tenant's homepage rows, so it is the arrangement's
 * name — one row of small tiles, scrolled — rather than a description of the
 * corner radius.
 *
 * It scrolls sideways at every width, and it is one row however many
 * departments the store has. It used to become a grid from `sm` up, which
 * forced a count on it: whatever did not fit the row was dropped, and a final
 * "More" tile stood in for the remainder.
 *
 * Both are gone. A rail that scrolls has no row to fill, so there is nothing to
 * truncate and nothing for a "More" tile to stand in for — every department is
 * on it, and reaching the far ones is a swipe rather than a page. Skimming a
 * catalogue works better sideways than in a grid that pushes the rest of the
 * homepage off the screen, which was already the reason for the phone layout.
 *
 * `limit` still caps it, but nothing passes one by default: a cap now hides
 * departments with no link left to reach them by.
 */
export function CategoryCircles({
  categories,
  limit,
  className,
}: {
  categories: Category[];
  limit?: number;
  className?: string;
}) {
  if (categories.length === 0) return null;

  const shown = limit === undefined ? categories : categories.slice(0, limit);

  return (
    <ul
      className={cn(
        // The negative margin is kept at every width now that the rail scrolls
        // at every width: it lets the tiles run to the edge of the section
        // rather than stopping short of it, so a half-tile at the boundary
        // reads as "there is more this way".
        'no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 sm:gap-5',
        className,
      )}
    >
      {shown.map((category) => (
        <li key={category.id} className="w-20 shrink-0 snap-start sm:w-[5.5rem]">
          <Link
            href={`/category/${category.slug}`}
            className="group flex flex-col items-center gap-2 text-center"
          >
            <span className="relative grid size-20 place-items-center overflow-hidden rounded-(--radius-card) bg-surface-alt ring-1 ring-border transition-all group-hover:ring-2 group-hover:ring-primary sm:size-[5.5rem]">
              {category.imageUrl ? (
                <Image
                  src={category.imageUrl}
                  alt=""
                  aria-hidden
                  fill
                  sizes="88px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <span className="text-lg font-semibold text-subtle">{category.name.charAt(0)}</span>
              )}
            </span>

            <span className="text-xs font-medium leading-snug text-foreground group-hover:text-primary sm:text-[13px]">
              {category.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
