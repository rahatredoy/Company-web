'use client';

import * as React from 'react';
import type { PromoBanner } from '@/types';
import { usePrefersReducedMotion } from '@/lib/hooks/use-prefers-reduced-motion';

/** How long one set of banners stays on screen before the next takes its place. */
export const BANNER_ROTATE_MS = 10_000;

/**
 * Cycles a list of promo banners through a fixed number of slots.
 *
 * A promo block has room for two or three panels and a store usually runs more
 * campaigns than that, so the ones past the third used to be dropped by a
 * `slice` and never seen. They take turns now: the block shows a full set,
 * swaps it for the next set every ten seconds, and comes back round.
 *
 * **Nothing rotates when everything already fits.** With three banners in three
 * slots there is nothing hidden to reveal, and shuffling them about would be
 * motion that carries no new information — the worst kind on a homepage.
 *
 * It stops for the same reasons `useAutoAdvance` does: while the pointer or
 * focus is inside the block, while the tab is in the background, and entirely
 * under `prefers-reduced-motion`.
 */
export function useBannerRotation(banners: PromoBanner[], slots: number) {
  const count = banners.length;
  // A short final page wraps round to the front rather than leaving holes in
  // the grid, so every page is full and the layout never changes shape.
  const perPage = Math.min(slots, count);
  const pages = perPage > 0 ? Math.ceil(count / perPage) : 0;

  const [page, setPage] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  // The first set is the served HTML and must not fade in on arrival; every set
  // after it is a change the eye needs help following.
  const [moved, setMoved] = React.useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const rotates = pages > 1 && !reducedMotion && !paused;

  React.useEffect(() => {
    if (!rotates) return;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setMoved(true);
      setPage((current) => (current + 1) % pages);
    }, BANNER_ROTATE_MS);

    return () => window.clearInterval(timer);
  }, [rotates, pages]);

  // Clamped rather than reset: the banner list can shrink under a running
  // rotation, and a page index past the end would render nothing at all.
  const active = pages > 0 ? page % pages : 0;

  const visible = React.useMemo(
    () =>
      Array.from({ length: perPage }, (_, index) => banners[(active * perPage + index) % count]!),
    [banners, active, perPage, count],
  );

  const pauseProps = React.useMemo(
    () => ({
      onMouseEnter: () => setPaused(true),
      onMouseLeave: () => setPaused(false),
      onFocusCapture: () => setPaused(true),
      onBlurCapture: () => setPaused(false),
    }),
    [],
  );

  return {
    /** The banners on screen right now — always `perPage` of them. */
    visible,
    page: active,
    pages,
    pauseProps,
    /** Spread onto each slot alongside a key that includes `page`. */
    frameClassName: moved ? 'animate-in fade-in duration-500' : undefined,
  };
}
