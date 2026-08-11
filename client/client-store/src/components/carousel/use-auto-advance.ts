'use client';

import * as React from 'react';
import { usePrefersReducedMotion } from '@/lib/hooks/use-prefers-reduced-motion';
import { useCarousel } from './carousel';

/**
 * Advances a carousel on a timer, and knows when to stop.
 *
 * It stops:
 *
 * - **permanently**, the moment the visitor uses an arrow, a dot, or swipes.
 *   Once someone has chosen a slide, moving it out from under them is the
 *   single most disliked thing a carousel does.
 * - while the pointer is over it, or focus is inside it — you cannot read a
 *   panel or tab through its links if it changes mid-way.
 * - while the tab is in the background, which also stops a hidden tab burning
 *   a timer and re-rendering forever.
 * - entirely, if the visitor has asked the system to reduce motion. `globals.css`
 *   can neutralise a CSS transition, but no stylesheet can cancel a component
 *   swapping its own contents.
 */
export function useAutoAdvance({
  intervalMs = 6000,
  enabled = true,
}: {
  intervalMs?: number;
  enabled?: boolean;
} = {}) {
  const { scrollBy, count, interacted } = useCarousel();
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = React.useState(false);

  const running = enabled && count > 1 && !interacted && !reducedMotion && !paused;

  React.useEffect(() => {
    if (!running) return;

    const tick = () => {
      if (document.hidden) return;
      scrollBy(1);
    };

    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [running, intervalMs, scrollBy]);

  /** Spread onto the element that should pause it — usually the carousel root. */
  const pauseProps = React.useMemo(
    () => ({
      onMouseEnter: () => setPaused(true),
      onMouseLeave: () => setPaused(false),
      onFocusCapture: () => setPaused(true),
      onBlurCapture: () => setPaused(false),
    }),
    [],
  );

  return { running, pauseProps };
}
