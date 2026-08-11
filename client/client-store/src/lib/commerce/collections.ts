'use client';

import * as React from 'react';
import { COMPARE_LIMIT, RECENTLY_VIEWED_LIMIT } from '@/config';
import type { ProductSummary } from '@/types';
import { createPersistedStore } from './persisted-store';

/**
 * Wishlist, compare and recently-viewed.
 *
 * Three lists of products with the same shape, so they share one implementation
 * and differ only in their cap and their key. Each stores the full
 * `ProductSummary` rather than an id: these lists are rendered on pages that do
 * not otherwise fetch those products, and a wishlist that has to resolve twelve
 * ids before it can draw anything is a wishlist that flashes empty first.
 *
 * The trade-off is that a stored price can go stale. The wishlist page says so,
 * and the cart re-reads the live price on add — a stale number is never what
 * gets charged.
 */

function parseProducts(raw: unknown): ProductSummary[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (item): item is ProductSummary =>
      Boolean(item) && typeof item === 'object' && typeof (item as ProductSummary).id === 'string',
  );
}

function createProductList(key: string, limit: number) {
  const store = createPersistedStore<ProductSummary[]>({
    key,
    initial: [],
    parse: parseProducts,
  });

  return function useProductList() {
    const items = React.useSyncExternalStore(
      store.subscribe.bind(store),
      store.get.bind(store),
      store.serverSnapshot.bind(store),
    );

    const has = React.useCallback(
      (id: string) => items.some((item) => item.id === id),
      [items],
    );

    const add = React.useCallback((product: ProductSummary) => {
      store.set((current) => {
        // Re-adding moves it to the front rather than duplicating it, which is
        // what "recently viewed" needs and what the others tolerate.
        const without = current.filter((item) => item.id !== product.id);
        return [product, ...without].slice(0, limit);
      });
    }, []);

    const remove = React.useCallback((id: string) => {
      store.set((current) => current.filter((item) => item.id !== id));
    }, []);

    const toggle = React.useCallback(
      (product: ProductSummary): boolean => {
        const present = store.get().some((item) => item.id === product.id);
        if (present) remove(product.id);
        else add(product);
        return !present;
      },
      [add, remove],
    );

    const clear = React.useCallback(() => store.set([]), []);

    /** True when the list is full and `product` is not already in it. */
    const isFull = React.useCallback(
      (id: string) => items.length >= limit && !items.some((item) => item.id === id),
      [items],
    );

    return { items, count: items.length, limit, has, add, remove, toggle, clear, isFull };
  };
}

/** No practical cap: a wishlist is the shopper's own list, not a widget. */
export const useWishlist = createProductList('sf_wishlist', 200);

/** Four, matching the comparison table's column budget. */
export const useCompare = createProductList('sf_compare', COMPARE_LIMIT);

export const useRecentlyViewed = createProductList('sf_recent', RECENTLY_VIEWED_LIMIT);
