import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import type { ProductListResult, SortValue } from '@/types';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import { Button } from '@/components/ui/button';
import { DesktopFilters, MobileFilters, Pagination, SortSelect } from './listing-controls';
import { pluralise } from '@/lib/utils';

export function Breadcrumb({ trail }: { trail: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <li>
          <Link href="/" className="hover:text-primary">
            Home
          </Link>
        </li>
        {trail.map((crumb, index) => (
          <li key={crumb.name} className="flex items-center gap-1.5">
            <span aria-hidden className="text-subtle">
              /
            </span>
            {crumb.href && index < trail.length - 1 ? (
              <Link href={crumb.href} className="hover:text-primary">
                {crumb.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {crumb.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Shared body of every listing page — `/shop`, a category, a brand, a search.
 *
 * The four differ only in their heading and which filter is pre-applied, so
 * they share this. Sorting, filtering, pagination and the empty state behave
 * identically wherever a shopper lands.
 */
export function ProductListing({
  result,
  sort,
  cardVariant,
  gridClassName,
  locale,
  emptyTitle = 'No products found',
  emptyBody = 'Try removing a filter, or browse another category.',
}: {
  result: ProductListResult;
  sort: SortValue;
  cardVariant: ProductCardVariant;
  gridClassName: string;
  locale: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const { items, meta, filters } = result;

  return (
    <div className="flex gap-8">
      <DesktopFilters filters={filters} />

      <div className="min-w-0 flex-1">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" role="status">
            {meta.total} {pluralise(meta.total, 'product')}
          </p>
          <div className="flex items-center gap-2">
            <MobileFilters filters={filters} total={meta.total} />
            <SortSelect value={sort} />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-(--radius-card) border border-border bg-surface px-6 py-16 text-center">
            <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-surface-alt text-subtle">
              <PackageSearch className="size-6" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">{emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{emptyBody}</p>
            {/* An empty state without a next action is a dead end. */}
            <Button asChild variant="outline" className="mt-6">
              <Link href="/shop">Browse all products</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className={gridClassName}>
              {items.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  variant={cardVariant}
                  locale={locale}
                  // The first row is above the fold on most screens.
                  priority={index < 4}
                />
              ))}
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} />
          </>
        )}
      </div>
    </div>
  );
}
