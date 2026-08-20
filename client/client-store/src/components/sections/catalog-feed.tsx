'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import type { ProductSummary, SortValue } from '@/types';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import { Button } from '@/components/ui/button';
import { loadCatalogPage } from '@/app/actions/catalog';
import { pluralise } from '@/lib/utils';

/**
 * The whole shop, on the homepage, a batch at a time.
 *
 * Every other product block on the page answers a question — the newest, the
 * best selling, the deepest discount — and shows between eight and twenty-four
 * products doing it. That is the right shape for a rail and the wrong shape for
 * "everything we sell": a shopper who wants to see the catalogue should not have
 * to work out that `/shop` exists.
 *
 * So this block pages the ordinary listing endpoint instead of naming ids. It
 * cannot be a longer rail — a section's product list is resolved server-side and
 * capped at 24, deliberately, because a homepage response is cached at four
 * layers and a shop with two thousand products would be pushing all of them
 * through every one of those caches on every visit. Paging keeps the cached
 * homepage the size it always was and puts the rest behind a button the visitor
 * has to ask for.
 *
 * **The first batch is the server's and stays the server's.** It arrives already
 * rendered — so the block costs nothing extra above the fold and search engines
 * see products rather than a spinner — and this component only ever appends to
 * it. Holding it in state instead would freeze whatever was true at mount, and a
 * price or a stock badge that a `router.refresh()` cannot move is exactly the
 * kind of stale the four cache layers are already carefully bounded to avoid.
 */
export function CatalogFeed({
  initial,
  total,
  sort,
  category,
  exclude,
  cardVariant,
  gridClassName,
  locale,
}: {
  initial: ProductSummary[];
  total: number;
  sort: SortValue;
  /** Pages one category and its descendants instead of the whole shop. */
  category?: string;
  /**
   * Ids already on the page above this grid, hidden from every batch.
   *
   * The product page puts this grid under the product's own rail, and a card
   * that has just been scrolled past reads as the list having failed to move
   * rather than as a second chance to buy it.
   */
  exclude?: string[];
  cardVariant: ProductCardVariant;
  gridClassName: string;
  locale: string;
}) {
  const [extra, setExtra] = React.useState<ProductSummary[]>([]);
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [exhausted, setExhausted] = React.useState(false);

  /*
   * Nothing here watches `initial` for changes. A first batch that has genuinely
   * moved on — a product added, removed or re-sorted — makes the pages appended
   * below it pages of a different list, and the answer to that is to start
   * again rather than to reconcile: `CatalogFeedSection` keys this component on
   * a fingerprint of the batch, so React remounts it and every piece of state
   * below resets together.
   */

  /*
   * Deduplicated on the way in, because paging a live catalogue is not a
   * snapshot: a product published between two batches shifts every row after it
   * down by one, and the same card would arrive twice with the same React key.
   */
  const raw = React.useMemo(() => {
    const seen = new Set<string>();
    return [...initial, ...extra].filter((product) => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });
  }, [initial, extra]);

  const hidden = React.useMemo(() => new Set(exclude ?? []), [exclude]);
  const items = React.useMemo(
    () => (hidden.size === 0 ? raw : raw.filter((product) => !hidden.has(product.id))),
    [raw, hidden],
  );

  /*
   * Counted on the *raw* batches rather than on what survived `hidden`.
   *
   * A page whose every product is already on screen above still moved the
   * cursor forward, so measuring progress by what is drawn would leave "load
   * more" believing there was a page left for as long as anything was hidden —
   * and, the other way round, subtracting the hidden ids from `total` would
   * retire the button while products nobody has seen were still unfetched.
   */
  const remaining = Math.max(0, total - raw.length);
  const hasMore = !exhausted && remaining > 0;

  const loadMore = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);

    try {
      const next = await loadCatalogPage({ page: page + 1, sort, category });
      // An empty batch is the end of the list, whatever the count said — the
      // total was read one request earlier and the shop may have shrunk since.
      if (next.items.length === 0) setExhausted(true);
      else {
        setExtra((current) => [...current, ...next.items]);
        setPage((current) => current + 1);
      }
    } catch {
      // Nothing is discarded on a failure: the products already on screen stay,
      // and the button becomes "Try again" rather than the page becoming empty.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div>
      <div className={gridClassName}>
        {/* Never `priority`: a whole-catalogue feed sits below every other
            block on the page, so eagerly loading its images would compete with
            the hero for the bandwidth that decides LCP. */}
        {items.map((product) => (
          <ProductCard key={product.id} product={product} variant={cardVariant} locale={locale} />
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        {/* The total is the listing's, so it counts the hidden ids too — quoted
            against what is drawn it would read as a grid that never finishes
            arriving. A filtered grid says how much of itself it is showing and
            leaves the total to the "shop all" link beside its heading. */}
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {hidden.size === 0
            ? `Showing ${items.length} of ${total} ${pluralise(total, 'product')}`
            : `Showing ${items.length} ${pluralise(items.length, 'product')}`}
        </p>

        {failed ? (
          <p className="text-sm text-error">That did not load. Check your connection and try again.</p>
        ) : null}

        {hasMore ? (
          <Button variant="outline" onClick={loadMore} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> Loading
              </>
            ) : failed ? (
              'Try again'
            ) : (
              `Load ${Math.min(remaining, 24)} more`
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
