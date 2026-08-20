'use client';

import * as React from 'react';

/**
 * Keeps one panel's client-side crash inside that panel.
 *
 * The route's `error.tsx` catches the same throws, but it replaces the **whole
 * screen**: a chart library choking on one odd data point would cost the owner
 * their orders, their stock warnings and their quick actions as well. This
 * contains it to the card it happened in, and the rest of the dashboard carries
 * on — which is the point of building the screen out of independent sections in
 * the first place.
 *
 * A class is not a style choice: `componentDidCatch` has no hook equivalent, and
 * React offers no other way to stop an error propagating.
 */
export class PanelBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Left in the browser console rather than reported anywhere: the panel has
    // no error sink, and swallowing it silently would make this unfixable.
    console.error('dashboard panel failed', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
