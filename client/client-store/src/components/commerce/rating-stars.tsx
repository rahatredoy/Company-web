import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Stars are decorative; the accessible name carries the actual value. Rating
 * must never be communicated by shape alone, so the count and average are also
 * available as text to screen readers.
 */
export function RatingStars({
  rating,
  count,
  showCount = true,
  size = 'sm',
  className,
}: {
  rating: number;
  count?: number;
  showCount?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const rounded = Math.round(rating * 2) / 2;
  const starSize = { xs: 'size-3', sm: 'size-3.5', md: 'size-4' }[size];
  const textSize = { xs: 'text-[11px]', sm: 'text-xs', md: 'text-sm' }[size];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((position) => {
          const filled = rounded >= position;
          const half = !filled && rounded >= position - 0.5;
          return (
            <span key={position} className="relative inline-block">
              <Star className={cn(starSize, 'text-border-strong')} strokeWidth={1.5} />
              {filled || half ? (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={half ? { width: '50%' } : undefined}
                >
                  <Star className={cn(starSize, 'fill-star text-star')} strokeWidth={1.5} />
                </span>
              ) : null}
            </span>
          );
        })}
      </span>

      <span className="sr-only">
        Rated {rating.toFixed(1)} out of 5
        {typeof count === 'number' ? ` from ${count} reviews` : ''}
      </span>

      {showCount && typeof count === 'number' ? (
        <span className={cn(textSize, 'text-subtle')} aria-hidden>
          ({count})
        </span>
      ) : null}
    </span>
  );
}
