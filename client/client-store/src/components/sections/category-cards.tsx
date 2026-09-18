import Image from 'next/image';
import Link from 'next/link';
import type { Category } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

/**
 * Category tiles with the label over the photograph.
 *
 * Three densities off one component:
 *
 * - `card` — the six-across editorial row, name plus "View Collection".
 * - `editorial` — taller, fewer, more air; for the minimal and lifestyle looks.
 * - `compact` — a dense marketplace grid where the count matters more than the
 *   picture.
 *
 * The image is `aria-hidden` and the link carries the text, so a screen reader
 * gets "Women's Fashion, link" rather than a description of a photograph
 * followed by the same words again.
 */
export async function CategoryCards({
  categories,
  style = 'card',
  limit = 12,
  showCount = false,
  className,
}: {
  categories: Category[];
  style?: TemplatePreset['categoryStyle'];
  limit?: number;
  showCount?: boolean;
  className?: string;
}) {
  if (categories.length === 0) return null;

  const t = await getT();
  const shown = categories.slice(0, limit);
  const editorial = style === 'editorial';
  const compact = style === 'compact';

  return (
    <ul
      className={cn(
        'grid gap-3 sm:gap-4',
        compact
          ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6'
          : editorial
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {shown.map((category) => (
        <li key={category.id}>
          <Link
            href={`/category/${category.slug}`}
            className={cn(
              'group relative flex overflow-hidden rounded-(--radius-card) bg-surface-alt',
              editorial ? 'aspect-4/5' : compact ? 'aspect-square' : 'aspect-4/3',
            )}
          >
            {category.imageUrl ? (
              <Image
                src={category.imageUrl}
                alt=""
                aria-hidden
                fill
                sizes={
                  editorial
                    ? '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'
                    : '(min-width: 1024px) 17vw, (min-width: 640px) 33vw, 50vw'
                }
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : null}

            {/* Type sits on photography, so it needs a scrim to stay legible. */}
            <span
              aria-hidden
              className="absolute inset-0 bg-linear-to-t from-black/70 via-black/25 to-transparent"
            />

            <span
              className={cn(
                'relative mt-auto w-full p-3 text-white sm:p-4',
                editorial && 'p-5 sm:p-6',
              )}
            >
              <span
                className={cn(
                  'block font-semibold leading-tight',
                  editorial ? 'text-xl sm:text-2xl' : compact ? 'text-xs sm:text-sm' : 'text-sm sm:text-base',
                )}
              >
                {category.name}
              </span>

              <span className="mt-0.5 block text-[10.5px] opacity-85 sm:text-xs">
                {showCount ? t('{count} products', { count: category.productCount }) : t('View Collection')}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
