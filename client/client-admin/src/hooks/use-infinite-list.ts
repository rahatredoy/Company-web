'use client';

import * as React from 'react';
import { apiFetchListed, errorMessage, type ListMeta } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BATCH_SIZE } from '@/lib/list';

/**
 * The browser half of a cursor-paginated list.
 *
 * The server component renders the first batch, so the table is on screen before
 * any JavaScript runs; this hook appends the ones after it as the reader nears
 * the bottom. It deliberately does **not** own the first batch — `rows` is
 * `initial.rows` with the appended batches after it — because the first batch is
 * re-rendered by the server on every `router.refresh()`, and a copy held in
 * state here would keep showing what a write had just changed.
 *
 * A batch is asked for by cursor, never by page number: `?page=40` makes the
 * database walk and discard 39 pages of rows to reach the fortieth, which is
 * precisely the request an infinite scroll makes most often.
 */

export interface InfiniteList<T> {
  /** The first batch and every batch appended to it, in order, without repeats. */
  rows: T[];
  /** Counted once, on the first batch. Null when the API did not report one. */
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  /** Set when a batch failed. Blocks further automatic loads until `retry`. */
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

export function useInfiniteList<T extends { id: string }>({
  path,
  query,
  initial,
  batchSize = BATCH_SIZE,
}: {
  path: string;
  /** The filters the first batch was read with. Every later batch repeats them. */
  query: Record<string, string | number | boolean | undefined>;
  initial: { rows: T[]; meta: ListMeta };
  batchSize?: number;
}): InfiniteList<T> {
  const t = useT();
  const [more, setMore] = React.useState<T[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(initial.meta.nextCursor);
  const [hasMore, setHasMore] = React.useState(initial.meta.hasMore);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /*
   * What the appended batches belong to.
   *
   * The filters identify the list; `nextCursor` identifies the first batch
   * *within* it, so a `router.refresh()` after a write that changed nothing
   * keeps the reader where they were, while one that deleted a row — moving the
   * first batch's last row, and so its cursor — starts the appending again from
   * a first batch that is once more contiguous with what follows it.
   */
  const stamp = `${JSON.stringify(query)}|${initial.meta.nextCursor ?? ''}`;
  const [lastStamp, setLastStamp] = React.useState(stamp);

  // Adjusted during render rather than in an effect, which would paint one frame
  // of the previous list's appended rows underneath the new first batch.
  if (stamp !== lastStamp) {
    setLastStamp(stamp);
    setMore([]);
    setCursor(initial.meta.nextCursor);
    setHasMore(initial.meta.hasMore);
    setError(null);
  }

  /**
   * Asks for the batch after the one in hand.
   *
   * A plain closure, not a memoised one: it reads `cursor`, `loading` and
   * `error`, so any identity that outlived a render would be reading stale ones.
   * `InfiniteTable` holds it in a ref instead, which is what keeps its
   * load-when-near-the-bottom effect from re-running on every render.
   */
  function load(from: string) {
    setLoading(true);
    void apiFetchListed<T>(path, { query: { ...query, cursor: from, pageSize: batchSize } })
      .then((batch) => {
        /*
         * Appended by id, skipping what is already held. A batch can arrive
         * twice — React runs an effect twice in development on purpose — and
         * both answers are identical, so ignoring the second is the whole fix.
         */
        setMore((current) => {
          const seen = new Set(current.map((row) => row.id));
          return [...current, ...batch.data.filter((row) => !seen.has(row.id))];
        });
        setCursor(batch.meta.nextCursor);
        setHasMore(batch.meta.hasMore);
      })
      .catch((caught: unknown) => setError(errorMessage(caught, t('Could not load more rows.'))))
      .finally(() => setLoading(false));
  }

  const loadMore = () => {
    // A failed batch stops the scroll from asking again on every pixel. `retry`
    // is the only way back, so a dead API is one message rather than hundreds.
    if (loading || error || !cursor) return;
    load(cursor);
  };

  const retry = () => {
    if (loading || !cursor) return;
    setError(null);
    load(cursor);
  };

  /*
   * A row can arrive twice if it moved into the first batch between the render
   * that produced it and the batch that was already appended — a refresh after a
   * write is exactly that. The first batch wins, because it is the newer read.
   */
  const rows = React.useMemo(() => {
    if (more.length === 0) return initial.rows;
    const seen = new Set(initial.rows.map((row) => row.id));
    return [...initial.rows, ...more.filter((row) => !seen.has(row.id))];
  }, [initial.rows, more]);

  return {
    rows,
    total: initial.meta.total ?? null,
    hasMore,
    loading,
    error,
    loadMore,
    retry,
  };
}
