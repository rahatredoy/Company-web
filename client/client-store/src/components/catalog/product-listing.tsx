import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import type { ProductListResult, SortValue } from '@/types';
import type { ProductQuery } from '@/lib/api/products';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { Button } from '@/components/ui/button';
import { DesktopFilters, MobileFilters, SortSelect } from './listing-controls';
import { ListingFeed } from './listing-feed';
import { getT } from '@/lib/i18n/server';

/**
 * Shared body of every listing page — `/shop`, a category, a brand, a search.
 *
 * The four differ only in their heading and which filter is pre-applied, so
 * they share this. Sorting, filtering, the scroll that keeps the grid filling
 * and the empty state all behave identically wherever a shopper lands.
 */
export async function ProductListing({
  result,
  query,
  sort,
  cardVariant,
  gridClassName,
  locale,
  currency,
  emptyTitle,
  emptyBody,
}: {
  result: ProductListResult;
  /**
   * The parsed filters behind this result, handed to the feed so a batch it
   * fetches later is a batch of the same list. It is the page's own parse, not
   * a second one — a listing whose "load more" disagreed with its first screen
   * would repeat and skip products with nothing on screen to say why.
   */
  query: ProductQuery;
  sort: SortValue;
  cardVariant: ProductCardVariant;
  gridClassName: string;
  locale: string;
  /** The store's currency, so the price bands can be labelled in it. */
  currency: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const { items, meta, filters } = result;
  const t = await getT();

  return (
    <div className="flex gap-8">
      <DesktopFilters filters={filters} locale={locale} currency={currency} />

      <div className="min-w-0 flex-1">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" role="status">
            {t.plural(meta.total, '{count} product', '{count} products')}
          </p>
          <div className="flex items-center gap-2">
            <MobileFilters filters={filters} total={meta.total} locale={locale} currency={currency} />
            <SortSelect value={sort} />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-(--radius-card) border border-border bg-surface px-6 py-16 text-center">
            <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-surface-alt text-subtle">
              <PackageSearch className="size-6" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">{emptyTitle ?? t('No products found')}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              {emptyBody ?? t('Try removing a filter, or browse another category.')}
            </p>
            {/* An empty state without a next action is a dead end. */}
            <Button asChild variant="outline" className="mt-6">
              <Link href="/shop">{t('Browse all products')}</Link>
            </Button>
          </div>
        ) : (
          /*
            Keyed on the batch, not on the page.

            When the first batch a visitor was given is no longer the first batch
            of the list — a filter ticked, a sort changed, a product published —
            everything appended below it belongs to a list that no longer exists.
            Remounting is the whole reset, and putting it here, where the new
            batch is, beats an effect inside the feed watching a prop.
          */
          <ListingFeed
            key={`${meta.total}:${items[0]?.id ?? ''}:${items.at(-1)?.id ?? ''}`}
            initial={items}
            total={meta.total}
            query={query}
            cardVariant={cardVariant}
            gridClassName={gridClassName}
            locale={locale}
          />
        )}
      </div>
    </div>
  );
}
