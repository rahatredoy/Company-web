'use client';

import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PAGE_SIZE } from '@/config';
import type { ProductQuery } from '@/lib/api/products';
import type { ProductSummary } from '@/types';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import { useT } from '@/lib/i18n';
import { loadListingPage } from '@/app/actions/listing';

/**
 * The grid every listing page draws, and the scroll that keeps it filling.
 *
 * There are no page numbers anywhere in the storefront now. A pager made a
 * shopper decide, twenty products in, whether the shop was worth a second
 * click — and paid for that decision twice, because page two was a fresh
 * document: the header, the filter rail, the facets and the count all re-fetched
 * and re-rendered to change the twenty cards in the middle. A batch is the
 * middle only, over a connection that is already open.
 *
 * **The first batch is the server's and stays the server's.** It arrives already
 * rendered, so the page paints its products without waiting for JavaScript and a
 * crawler sees them; this component only ever appends. Holding it in state
 * instead would freeze whatever was true at mount, and a price or a stock badge
 * that a `router.refresh()` cannot move is exactly the staleness the four cache
 * layers behind it are carefully bounded to avoid.
 */
export function ListingFeed({
  initial,
  total,
  query,
  cardVariant,
  gridClassName,
  locale,
}: {
  initial: ProductSummary[];
  total: number;
  /** The filters this listing is under, sent back with each batch request. */
  query: ProductQuery;
  cardVariant: ProductCardVariant;
  gridClassName: string;
  locale: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();

  const [extra, setExtra] = React.useState<ProductSummary[]>([]);
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [exhausted, setExhausted] = React.useState(false);

  /*
   * Nothing here watches `initial`. A first batch that has genuinely moved on —
   * a filter changed, a product added or re-sorted — makes everything appended
   * below it part of a list that no longer exists, and the answer to that is to
   * start again rather than to reconcile. `ProductListing` keys this component
   * on a fingerprint of the batch, so React remounts it and every piece of state
   * here resets together.
   */

  /*
   * Deduplicated on the way in, because paging a live catalogue is not a
   * snapshot: a product published between two batches shifts every row after it
   * down by one, and the same card would arrive twice under the same React key.
   */
  const items = React.useMemo(() => {
    const seen = new Set<string>();
    return [...initial, ...extra].filter((product) => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });
  }, [initial, extra]);

  const remaining = Math.max(0, total - items.length);
  const hasMore = !exhausted && remaining > 0;

  const loadMore = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);

    try {
      const next = await loadListingPage({ page: page + 1, query });
      // An empty batch is the end of the list whatever the count said — the
      // total was read one request earlier and the shop may have shrunk since.
      if (next.items.length === 0) setExhausted(true);
      else {
        setExtra((current) => [...current, ...next.items]);
        setPage((current) => current + 1);
      }
    } catch {
      // Nothing already on screen is discarded on a failure: the grid stays and
      // the link below it becomes "Try again".
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy, page, query]);

  /*
   * The trigger is the last item **inside** the grid, not a marker under it.
   *
   * On a phone the storefront turns every product grid into a sideways-scrolled
   * rail (see `globals.css`), so "below the grid" is on screen from the first
   * frame and a marker there would pull the whole catalogue down at once. As a
   * child of the grid it is instead carried to the far end of the rail, where an
   * `IntersectionObserver` — which accounts for clipping by every scrolling
   * ancestor — reports it hidden until the shopper actually reaches it. The same
   * element answers both layouts, with no branch on which one is in force.
   *
   * The observer is rebuilt after each batch, since it only reports *crossings*:
   * a marker that stayed in view — a screen taller than the batch is long —
   * would otherwise never report again, and the scroll would stall one batch in.
   */
  const markerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const node = markerRef.current;
    // After a failure the shopper asks again explicitly. Retrying on scroll
    // would hammer an API that has just said no, invisibly.
    if (!node || !hasMore || failed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      // Roughly a screen ahead, so the next batch is usually already there by
      // the time the shopper scrolls onto it.
      { rootMargin: '600px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, failed, loadMore]);

  /**
   * The same batch as a plain link, for whoever has no JavaScript — a crawler
   * included. `?page=` still works on every one of these routes: the listing
   * endpoint never stopped accepting it, so this is a real page rather than a
   * button dressed as one, and it is what keeps a scrolled listing crawlable.
   */
  const nextHref = React.useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.set('page', String(page + 1));
    return `${pathname}?${next.toString()}`;
  }, [params, pathname, page]);

  return (
    <div>
      <div className={gridClassName}>
        {items.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            variant={cardVariant}
            locale={locale}
            // The first row is above the fold on most screens. Nothing after the
            // first batch ever is, by definition — it was scrolled to.
            priority={index < 4}
          />
        ))}

        {hasMore ? <div ref={markerRef} aria-hidden className="col-span-full h-1" /> : null}
      </div>

      {hasMore || busy ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="text-sm text-muted" role="status" aria-live="polite">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {t('Loading more products')}
              </span>
            ) : (
              t.plural(total, 'Showing {shown} of {count} product', 'Showing {shown} of {count} products', {
                shown: items.length,
              })
            )}
          </p>

          {failed ? (
            <p className="text-sm text-error">{t('That did not load. Check your connection and try again.')}</p>
          ) : null}

          {hasMore ? (
            <a
              href={nextHref}
              onClick={(event) => {
                // Modified clicks are the visitor asking for a real navigation —
                // a new tab, a saved link — and page two is a real page.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                void loadMore();
              }}
              className="rounded-(--radius-button) border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            >
              {failed ? t('Try again') : t('Show {count} more', { count: Math.min(remaining, PAGE_SIZE.shop) })}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
