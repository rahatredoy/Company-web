import { cn } from '@/lib/utils';

/**
 * A loading placeholder.
 *
 * Marked `aria-hidden` and paired with a single visually-hidden status message
 * by its container. A grid of twenty-four shimmering boxes announced one by one
 * is worse for a screen reader than saying "Loading products" once.
 *
 * The pulse animation is defined in `globals.css` and is neutralised there
 * under `prefers-reduced-motion`.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />;
}

/** Card-shaped placeholder matching the product grid's proportions. */
export function ProductCardSkeleton({ portrait = false }: { portrait?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className={cn('w-full rounded-(--radius-card)', portrait ? 'aspect-3/4' : 'aspect-square')} />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

export function ProductGridSkeleton({
  count = 12,
  className = 'product-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4',
  portrait = false,
}: {
  count?: number;
  className?: string;
  portrait?: boolean;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading products…</span>
      <div className={className}>
        {Array.from({ length: count }, (_, index) => (
          <ProductCardSkeleton key={index} portrait={portrait} />
        ))}
      </div>
    </div>
  );
}
