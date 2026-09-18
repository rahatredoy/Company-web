'use client';

import * as React from 'react';
import { api, errorMessage } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';

/**
 * The record behind a **View** panel.
 *
 * Fetched when the panel opens rather than with the list, because a list batch
 * is twenty rows and a detail payload is the whole row plus everything pointing
 * at it — order lines, ledger movements, redemptions, addresses. Loading that
 * for twenty rows to show one would make every scroll pay for a panel nobody
 * opened.
 *
 * The reply is kept after the panel closes and keyed by id, so reopening the
 * same row is instant and closing one to open its neighbour does not re-read
 * the first. It is a cache of what was true when it was read, not a
 * subscription: `reload` is what a caller uses after a write.
 *
 * A stale response is dropped rather than rendered. Opening two rows quickly
 * leaves two requests in flight and they can land in either order; the effect's
 * own cleanup is what settles it, because moving to another row tears the first
 * effect down and its `cancelled` flag closes over that run alone. Without it
 * the slower request would paint its error and its spinner over the right row.
 */

/**
 * What a failed read says when the failure carried no message of its own.
 *
 * Stored as the English key and translated on the way out, rather than
 * translated inside the effect: that would make the translator a dependency of
 * the read, and the effect is written to run once per row.
 */
const LOAD_FAILED: MessageKey = 'That record could not be loaded.';

export interface Detail<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDetail<T>({
  path,
  id,
  suffix = '',
  enabled = true,
}: {
  /** The collection, without the id — `/api/v1/admin/orders`. */
  path: string;
  /** Which row the panel is pointed at. Null while it has never been opened. */
  id: string | null;
  /** Appended after the id, for a read about the row — `/insights?days=30`. */
  suffix?: string;
  /** False while the panel is shut, so opening is what triggers the read. */
  enabled?: boolean;
}): Detail<T> {
  const t = useT();
  const [cache, setCache] = React.useState<Record<string, T>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [generation, setGeneration] = React.useState(0);

  const reload = React.useCallback(() => setGeneration((value) => value + 1), []);

  /*
   * What has already been asked for, as `path:id:generation`.
   *
   * A set rather than a single value because the panel moves between rows and
   * each is remembered; the generation is in the key so that `reload` asks
   * again for the row it is called on without invalidating the others.
   */
  const asked = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (!enabled || !id) return;

    const key = `${path}:${id}${suffix}:${generation}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<T>(`${path}/${id}${suffix}`)
      .then((data) => {
        if (cancelled) return;
        setCache((previous) => ({ ...previous, [id]: data }));
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        // Forgotten, so closing and reopening the row retries rather than
        // leaving an error the reader has no way to clear.
        asked.current.delete(key);
        setError(errorMessage(cause, LOAD_FAILED));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, id, suffix, enabled, generation]);

  const cached = id ? cache[id] : undefined;

  return {
    data: cached ?? null,
    // Only while there is nothing to show. A `reload` over a record already on
    // screen refreshes it in place rather than replacing it with skeletons.
    loading: loading && cached === undefined && error === null,
    error: error === LOAD_FAILED ? t(LOAD_FAILED) : error,
    reload,
  };
}

/**
 * The open/closed state of a list's view panel.
 *
 * A list has one panel, not one per row: mounting a sheet per row would put a
 * Radix portal behind every row on screen, and a virtualised list unmounts those
 * mid-scroll. So a row's button names which row is being viewed and one panel
 * reads it.
 *
 * The row is kept while the panel animates shut — clearing it on close would
 * blank the contents for the 200ms of the exit animation, which reads as a flash
 * of an empty sheet.
 */
export function useViewTarget<T>() {
  const [row, setRow] = React.useState<T | null>(null);
  const [open, setOpen] = React.useState(false);

  const view = React.useCallback((next: T) => {
    setRow(next);
    setOpen(true);
  }, []);

  return { row, open, view, onOpenChange: setOpen };
}

/**
 * A list's panel, opened on arrival when the address names a row.
 *
 * Other screens link to one record as `/<list>?view=<id>` — a return, a
 * customer — because a record has no screen of its own; it is read in its
 * list's panel. The page reads that id on the server and hands the row in, and
 * this opens the panel once for it. Closing drops `view` from the address
 * without a navigation, so a refresh or a filter change does not reopen a
 * record the reader shut. `OrderManager` does the same by hand.
 */
export function useAddressedView<T extends { id: string }>(initialView: T | null | undefined) {
  const viewing = useViewTarget<T>();
  const { view, onOpenChange } = viewing;

  const openedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (initialView && initialView.id !== openedFor.current) {
      openedFor.current = initialView.id;
      view(initialView);
    }
  }, [initialView, view]);

  const changeOpen = React.useCallback(
    (open: boolean) => {
      onOpenChange(open);
      const url = new URL(window.location.href);
      if (!open && url.searchParams.has('view')) {
        url.searchParams.delete('view');
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      }
    },
    [onOpenChange],
  );

  return { ...viewing, onOpenChange: changeOpen };
}
