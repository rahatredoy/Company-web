'use client';

import * as React from 'react';

/**
 * False during server render and the first client render, true after.
 *
 * Cart and wishlist counts live in `localStorage`, which the server cannot see.
 * Rendering them on the first pass produces markup that disagrees with the
 * server's and React replaces the whole subtree. Gating on this hook renders
 * nothing until hydration is complete, which is honest — the count genuinely is
 * unknown at that moment — and avoids reaching for `suppressHydrationWarning`,
 * which would silence the warning without fixing the mismatch.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** The value never changes after mount, so there is nothing to subscribe to. */
function subscribe(): () => void {
  return () => {};
}
