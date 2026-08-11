'use client';

/**
 * A tiny observable store backed by `localStorage`.
 *
 * Built on `useSyncExternalStore` rather than context state so that a cart badge
 * in the header and a line item in the drawer read the same value without the
 * whole tree re-rendering, and so the value survives a full page load — which
 * matters more here than in most apps, because every page in this storefront is
 * server-rendered and navigations are real requests.
 *
 * The `storage` event listener keeps two tabs of the same shop in agreement.
 * Without it, adding an item in one tab and checking out in another silently
 * loses the item.
 *
 * This is the **mock/offline** transport. When the Commerce API grows a cart
 * endpoint, `lib/commerce/index.ts` selects an API-backed store instead and no
 * component changes, because components only ever see the hooks.
 */

export interface PersistedStore<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** Server snapshot — always the empty value, since the server cannot read localStorage. */
  serverSnapshot(): T;
}

export function createPersistedStore<T>({
  key,
  initial,
  parse,
  version = 1,
}: {
  key: string;
  initial: T;
  /** Validates whatever was in storage; anything unexpected falls back. */
  parse: (raw: unknown) => T | null;
  version?: number;
}): PersistedStore<T> {
  const storageKey = `${key}:v${version}`;
  const listeners = new Set<() => void>();

  let cache: T = initial;
  let loaded = false;

  const read = (): T => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return initial;
      return parse(JSON.parse(raw)) ?? initial;
    } catch {
      // Corrupt or unreadable storage must not break the shop. Private-mode
      // Safari throws on access; a half-written value fails to parse.
      return initial;
    }
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    get() {
      if (!loaded && typeof window !== 'undefined') {
        cache = read();
        loaded = true;
      }
      return cache;
    },

    set(next) {
      const current = this.get();
      const value = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
      // Reference equality is the signal `useSyncExternalStore` relies on; an
      // unchanged reference must not notify, or every setter loops.
      if (value === current) return;

      cache = value;
      loaded = true;

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // Quota exceeded or storage disabled — the in-memory value still works
        // for this page, which is better than throwing mid add-to-cart.
      }

      emit();
    },

    subscribe(listener) {
      listeners.add(listener);

      const onStorage = (event: StorageEvent) => {
        if (event.key !== storageKey) return;
        cache = read();
        loaded = true;
        emit();
      };

      if (listeners.size === 1 && typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
      }

      return () => {
        listeners.delete(listener);
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },

    serverSnapshot() {
      return initial;
    },
  };
}
