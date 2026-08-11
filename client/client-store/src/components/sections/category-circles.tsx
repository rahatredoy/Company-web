import Image from 'next/image';
import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import type { Category } from '@/types';
import { cn } from '@/lib/utils';

/**
 * The circular category rail — eight to ten round tiles under the hero.
 *
 * On a phone it becomes a horizontal scroller rather than wrapping into four
 * cramped rows: the rail is a way to skim a catalogue, and skimming works
 * better sideways than in a grid that pushes everything else off the screen.
 *
 * The final "More" tile appears only when there are categories the rail did not
 * show, so it never sends someone to a page identical to the one they are on.
 */
export function CategoryCircles({
  categories,
  limit = 10,
  moreHref = '/categories',
  className,
}: {
  categories: Category[];
  limit?: number;
  moreHref?: string;
  className?: string;
}) {
  if (categories.length === 0) return null;

  const shown = categories.slice(0, limit);
  const hasMore = categories.length > shown.length;

  return (
    <ul
      className={cn(
        'no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:gap-5 sm:overflow-visible sm:px-0',
        'sm:grid-cols-5',
        hasMore ? 'lg:grid-cols-9' : 'lg:grid-cols-8',
        className,
      )}
    >
      {shown.map((category) => (
        <li key={category.id} className="w-20 shrink-0 snap-start sm:w-auto">
          <Link
            href={`/category/${category.slug}`}
            className="group flex flex-col items-center gap-2 text-center"
          >
            <span className="relative grid size-20 place-items-center overflow-hidden rounded-full bg-surface-alt ring-1 ring-border transition-all group-hover:ring-2 group-hover:ring-primary sm:size-[5.5rem]">
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

      {hasMore ? (
        <li className="w-20 shrink-0 snap-start sm:w-auto">
          <Link href={moreHref} className="group flex flex-col items-center gap-2 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-surface-alt text-subtle ring-1 ring-border transition-all group-hover:text-primary group-hover:ring-2 group-hover:ring-primary sm:size-[5.5rem]">
              <LayoutGrid className="size-6" aria-hidden />
            </span>
            <span className="text-xs font-medium leading-snug group-hover:text-primary sm:text-[13px]">
              More
            </span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
