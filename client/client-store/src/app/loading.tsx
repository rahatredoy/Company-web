import { ProductGridSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * The default route-level loading state.
 *
 * Shaped like the page it stands in for — a wide hero, a strip, a product grid
 * — so the layout does not jump when the real content arrives. A centred
 * spinner would be less work and would reserve none of the space.
 */
export default function Loading() {
  return (
    <div className="container-store space-y-10 py-6">
      <Skeleton className="h-64 w-full rounded-(--radius-card) sm:h-80 lg:h-[26rem]" />

      <div className="grid grid-cols-4 gap-4 sm:grid-cols-8">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <Skeleton className="size-16 rounded-(--radius-card) sm:size-20" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>

      <Skeleton className="h-24 w-full rounded-(--radius-card)" />

      <div className="space-y-6">
        <Skeleton className="mx-auto h-7 w-48" />
        <ProductGridSkeleton
          count={12}
          className="product-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        />
      </div>
    </div>
  );
}
