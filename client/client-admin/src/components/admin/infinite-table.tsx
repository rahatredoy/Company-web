'use client';

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Every list in the panel: rows appended as the reader nears the bottom, and
 * only the rows on screen actually in the DOM.
 *
 * **The table scrolls, not the page.** Virtualising against the window would
 * work, but it puts the scroll container outside this component's control and
 * makes the header's stickiness depend on whatever chrome each page happens to
 * have above it. A bounded box keeps both here, and is what makes the header
 * sticky without a second sticky offset per screen.
 *
 * **`table-layout: fixed` with a `<colgroup>` is not styling.** A virtualised
 * table only ever contains the rows on screen, so an `auto` layout would size
 * its columns from those rows — and resize them, visibly, on every scroll as
 * different content came into view. The widths are therefore declared per column
 * rather than measured, which is why columns are data here instead of JSX.
 */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /**
   * CSS width for this column's `<col>`. Leave it off exactly one column — the
   * one that should absorb the slack; with none, the remainder is split evenly.
   */
  width?: string;
  headClassName?: string;
  className?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

/**
 * The viewport the virtualiser assumes before it has an element to measure.
 *
 * Without this it measures nothing on the server, decides no row is visible, and
 * sends an empty table — the rows then appear only once JavaScript has run,
 * which throws away the whole point of rendering the first batch on the server.
 * A nominal window is enough: the real one is measured on mount and the list
 * re-flows to it, and being wrong for one frame costs nothing.
 */
const SSR_VIEWPORT = { width: 1280, height: 900 };

/**
 * How many rows from the end the next batch is asked for. Eight is roughly a
 * viewport's worth on these tables: enough that the batch lands before the
 * reader reaches the gap, and few enough that a slow flick does not queue two.
 */
const PREFETCH_WITHIN = 8;

/**
 * The newest `onLoadMore` without making it a dependency.
 *
 * `useInfiniteList` returns a plain closure — it has to, because it reads the
 * cursor and the loading flag, and a memoised one would read stale ones. Listing
 * it as a dependency below would therefore re-run the effect on every render.
 * Assigning through a ref *inside* an effect is what keeps the dependency list
 * to the things that actually decide whether to ask: where the reader is, and
 * whether there is anything left to ask for.
 */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function InfiniteTable<T extends { id: string }>({
  columns,
  rows,
  rowKey,
  hasMore,
  loading,
  error,
  onLoadMore,
  onRetry,
  total,
  noun = 'row',
  empty,
  estimateRowHeight = 57,
  maxHeight = 'calc(100svh - 19rem)',
  minWidth = '64rem',
  dense = false,
  dimmed = false,
  rowClassName,
  rowProps,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey?: (row: T) => string;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  /** What the whole filtered list holds, counted once by the API. */
  total: number | null;
  /** Singular noun for the footer tally — "product", "order". */
  noun?: string;
  empty: React.ReactNode;
  /** Starting guess only; every row is measured once it renders. */
  estimateRowHeight?: number;
  maxHeight?: string;
  /** Below this the box scrolls sideways rather than crushing the columns. */
  minWidth?: string;
  /**
   * Tighter cells, for a list whose rows carry two lines rather than one.
   *
   * Opt-in rather than the default: the padding is what separates one row from
   * the next, and taking it from a single-line list makes the rows run together.
   * A row that is already two lines tall has that separation from its own
   * content, so the space is only whitespace and costs the reader rows.
   */
  dense?: boolean;
  /** Dims the rows while the server re-reads them under a new filter. */
  dimmed?: boolean;
  rowClassName?: (row: T, index: number) => string | undefined;
  /**
   * Extra attributes for a row's `<tr>` — what the drag-to-reorder screens hang
   * their handlers on. Kept as an escape hatch rather than baked in: reordering
   * is two screens' behaviour, not every list's.
   */
  rowProps?: (row: T, index: number) => React.HTMLAttributes<HTMLTableRowElement> & { draggable?: boolean };
  className?: string;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimateRowHeight,
    // Enough rows either side that a fast scroll paints filled rows rather than
    // a blank band, without keeping a whole screen of them alive on each edge.
    overscan: 10,
    initialRect: SSR_VIEWPORT,
    getItemKey: (index) => {
      const row = rows[index];
      return row ? (rowKey ? rowKey(row) : row.id) : index;
    },
  });

  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];

  /*
   * The trigger is "the reader can see within eight rows of the end", not a
   * sentinel element: a sentinel row inside a `<tbody>` is not a row, and the
   * table would either have to lie about its column count or put a non-row
   * element where the browser expects one.
   *
   * It fires on an empty-but-unfilled list too, which is deliberate — a batch of
   * 25 on a tall monitor leaves the box unscrollable, and without this the
   * reader would have nothing to scroll and no way to ask for the rest.
   */
  const lastIndex = last?.index ?? -1;
  const askForMore = useLatest(onLoadMore);

  React.useEffect(() => {
    if (!hasMore || loading || error) return;
    if (rows.length === 0) return;
    if (lastIndex >= rows.length - 1 - PREFETCH_WITHIN) askForMore.current();
  }, [lastIndex, rows.length, hasMore, loading, error, askForMore]);

  const padTop = first ? first.start : 0;
  const padBottom = last ? virtualizer.getTotalSize() - last.end : 0;
  const span = columns.length;

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <div ref={scroller} className="overflow-auto overscroll-contain" style={{ maxHeight }}>
        <table className="w-full caption-bottom text-sm" style={{ tableLayout: 'fixed', minWidth }}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>

          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  /*
                   * Sticky on each `th` rather than on the `thead`: the rule for a
                   * sticky `thead` is newer than the one for its cells, and the
                   * bottom rule is an inset shadow because a border on a sticky
                   * element is painted at its original position, not its stuck one.
                   */
                  className={cn(
                    'sticky top-0 z-10 bg-card text-left align-middle text-xs font-semibold tracking-wide text-muted-foreground uppercase whitespace-nowrap',
                    dense ? 'h-9 px-3' : 'h-11 px-4',
                    'shadow-[inset_0_-1px_0_var(--color-border)]',
                    column.headClassName,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className={cn('transition-opacity', dimmed && 'opacity-60')}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={span} className="px-4 py-16 text-center text-sm text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              <>
                {/* The rows above the window, as height rather than as elements. */}
                {padTop > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={span} style={{ height: padTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}

                {items.map((item) => {
                  const row = rows[item.index];
                  if (!row) return null;

                  return (
                    <tr
                      key={item.key}
                      {...rowProps?.(row, item.index)}
                      data-index={item.index}
                      // Measured rather than assumed: a product row with two lines
                      // of text is not the height of an empty one, and a guess
                      // that is wrong by a few pixels compounds over a thousand
                      // rows into a scrollbar that lies.
                      ref={virtualizer.measureElement}
                      className={cn(
                        'border-b border-border transition-colors hover:bg-muted/60',
                        rowClassName?.(row, item.index),
                      )}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn('align-middle', dense ? 'px-3 py-2' : 'px-4 py-3', column.className)}
                        >
                          {column.cell(row, item.index)}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {padBottom > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={span} style={{ height: padBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>

      <ListFooter
        shown={rows.length}
        total={total}
        noun={noun}
        hasMore={hasMore}
        loading={loading}
        error={error}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}

/**
 * The same arrangement for the two screens that are lists of cards rather than
 * tables — messages and review moderation. A card has no columns to keep in
 * step, so this needs no `colgroup` and no fixed layout; everything else about
 * it (measured heights, a batch asked for eight items from the end, one footer)
 * is the same, and is why it lives beside the table rather than apart from it.
 */
export function InfiniteStack<T extends { id: string }>({
  rows,
  render,
  hasMore,
  loading,
  error,
  onLoadMore,
  onRetry,
  total,
  noun = 'item',
  empty,
  estimateRowHeight = 160,
  maxHeight = 'calc(100svh - 19rem)',
  gap = 12,
  className,
}: {
  rows: T[];
  render: (row: T, index: number) => React.ReactNode;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  total: number | null;
  noun?: string;
  empty: React.ReactNode;
  estimateRowHeight?: number;
  maxHeight?: string;
  /** Pixels between cards. Applied as bottom padding so it is inside the measure. */
  gap?: number;
  className?: string;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimateRowHeight,
    overscan: 6,
    initialRect: SSR_VIEWPORT,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? -1;
  const askForMore = useLatest(onLoadMore);

  React.useEffect(() => {
    if (!hasMore || loading || error || rows.length === 0) return;
    if (lastIndex >= rows.length - 1 - PREFETCH_WITHIN) askForMore.current();
  }, [lastIndex, rows.length, hasMore, loading, error, askForMore]);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <div ref={scroller} className="overflow-y-auto overscroll-contain p-3" style={{ maxHeight }}>
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;

              return (
                <li
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  // Absolutely positioned rather than padded into place: a card
                  // list has no rows to pad with, and `transform` keeps the
                  // browser from re-laying-out the whole stack on every scroll.
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    paddingBottom: gap,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {render(row, item.index)}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ListFooter
        shown={rows.length}
        total={total}
        noun={noun}
        hasMore={hasMore}
        loading={loading}
        error={error}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}

/**
 * What the numbered pager used to say, minus the numbers: how much of the list
 * is loaded, and whether anything is still coming.
 *
 * The button is not the mechanism — scrolling is — but it is the way back when a
 * batch fails, and the way through for someone driving the panel by keyboard,
 * who never generates the scroll event the automatic path waits for.
 */
function ListFooter({
  shown,
  total,
  noun,
  hasMore,
  loading,
  error,
  onRetry,
  onLoadMore,
}: {
  shown: number;
  total: number | null;
  noun: string;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const plural = `${noun}${shown === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {shown === 0
          ? `No ${noun}s to show`
          : total !== null && total > shown
            ? `Showing ${formatNumber(shown)} of ${formatNumber(total)} ${noun}${total === 1 ? '' : 's'}`
            : `${formatNumber(shown)} ${plural}`}
      </p>

      {error ? (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <TriangleAlert className="size-4" aria-hidden />
            {error}
          </span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading more…
        </span>
      ) : hasMore ? (
        <Button variant="outline" size="sm" onClick={onLoadMore}>
          Load more
        </Button>
      ) : shown > 0 ? (
        <span className="text-sm text-muted-foreground">End of list</span>
      ) : null}
    </div>
  );
}
