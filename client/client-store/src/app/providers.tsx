'use client';

import * as React from 'react';
import { Toaster } from 'sonner';

/**
 * Client-side providers, mounted once by the root layout.
 *
 * Deliberately thin. Cart, wishlist, compare and recently-viewed are external
 * stores read through `useSyncExternalStore`, not React context — they need no
 * provider, they do not re-render the tree when they change, and a header badge
 * subscribing to the cart does not force the page below it to re-render.
 *
 * What genuinely needs to be here is the toast host: it renders into a portal
 * and there must be exactly one of it per document.
 */
export function StorefrontProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}

      <Toaster
        position="bottom-center"
        // The store's own palette rather than sonner's, so a toast on an olive
        // shopfront is not suddenly a Tailwind-default grey card.
        toastOptions={{
          classNames: {
            toast:
              'rounded-(--radius-card) border border-border bg-surface text-foreground shadow-[var(--shadow-raised)]',
            description: 'text-muted',
            actionButton: 'bg-primary text-primary-foreground rounded-(--radius-button)',
            cancelButton: 'bg-surface-alt text-foreground rounded-(--radius-button)',
          },
        }}
        // Sonner's default 4s is too quick to read "added to cart" and reach
        // the "view cart" action beside it.
        duration={4500}
        gap={10}
        offset={16}
      />
    </>
  );
}
