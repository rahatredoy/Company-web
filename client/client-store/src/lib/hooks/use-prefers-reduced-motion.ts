'use client';

import * as React from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the visitor has asked the operating system to reduce motion.
 *
 * `globals.css` already neutralises CSS transitions under this preference, but
 * a hero that advances itself every six seconds is motion no stylesheet can
 * cancel — the element genuinely changes. Anything that moves on a timer has to
 * ask in JavaScript and simply not start.
 *
 * Returns `false` on the server and on the first client render, so the initial
 * markup matches; the real value arrives with the first subscription tick.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}
