'use client';

import * as React from 'react';
import type { Cart, CartLine, CartTotals } from '@/types';
import { createPersistedStore } from './persisted-store';
import { multiply, percentOf, subtract, sum, toMinor } from './money';

/**
 * The basket.
 *
 * Held in `localStorage` and totalled in the browser, because the Commerce API
 * has no cart endpoint yet. Both halves of that are deliberately behind this
 * one module: components call `useCart()` and never touch storage or arithmetic,
 * so when the endpoint lands only this file is replaced.
 *
 * The totals computed here are the **optimistic** view. Checkout recalculates
 * everything server-side against live prices, live stock and the real coupon
 * rules, and that answer is what gets charged. A basket that says one number and
 * a receipt that says another is a bug in this file, never in the server.
 */

export interface AddToCartInput {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPrice: string;
  unitSalePrice: string | null;
  currency: string;
  quantity: number;
  /** Bound from the product's own limit, so a line cannot exceed it. */
  maxQuantity?: number | null;
}

interface StoredCart {
  currency: string;
  lines: CartLine[];
  coupon: { code: string; label: string | null; discount: string } | null;
}

const EMPTY: StoredCart = { currency: 'USD', lines: [], coupon: null };

/** Demonstration coupons. Live, the API owns every one of these rules. */
const COUPONS: Record<string, { label: string; percent: number; minimum: number }> = {
  WELCOME20: { label: '20% off your first order', percent: 20, minimum: 0 },
  SAVE10: { label: '10% off', percent: 10, minimum: 5000 },
  URBAN20: { label: '20% off', percent: 20, minimum: 0 },
};

export type CouponError =
  | 'invalid'
  | 'minimum_not_met'
  | 'already_applied'
  | 'empty_cart';

function parseCart(raw: unknown): StoredCart | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<StoredCart>;
  if (!Array.isArray(value.lines)) return null;

  const lines = value.lines.filter(
    (line): line is CartLine =>
      Boolean(line) &&
      typeof line === 'object' &&
      typeof (line as CartLine).id === 'string' &&
      typeof (line as CartLine).quantity === 'number',
  );

  return {
    currency: typeof value.currency === 'string' ? value.currency : EMPTY.currency,
    lines,
    coupon: value.coupon && typeof value.coupon.code === 'string' ? value.coupon : null,
  };
}

const store = createPersistedStore<StoredCart>({
  key: 'sf_cart',
  initial: EMPTY,
  parse: parseCart,
});

const lineId = (productId: string, variantId: string) => `${productId}::${variantId}`;

function computeTotals(cart: StoredCart): CartTotals {
  const subtotal = sum(cart.lines.map((line) => line.lineTotal));

  const rule = cart.coupon ? COUPONS[cart.coupon.code] : undefined;
  const discount = rule ? percentOf(subtotal, rule.percent) : '0.00';

  return {
    subtotal,
    discount,
    // Null, not zero: shipping is not known until an address exists, and
    // showing "Free" before that would be a promise nobody made.
    shipping: null,
    tax: '0.00',
    total: subtract(subtotal, discount),
    currency: cart.currency,
  };
}

function toCart(stored: StoredCart): Cart {
  const totals = computeTotals(stored);

  return {
    id: 'local',
    lines: stored.lines,
    totals,
    coupon: stored.coupon ? { ...stored.coupon, discount: totals.discount } : null,
    itemCount: stored.lines.reduce((count, line) => count + line.quantity, 0),
  };
}

export function useCart() {
  const stored = React.useSyncExternalStore(
    store.subscribe.bind(store),
    store.get.bind(store),
    store.serverSnapshot.bind(store),
  );

  const cart = React.useMemo(() => toCart(stored), [stored]);

  const add = React.useCallback((input: AddToCartInput) => {
    const id = lineId(input.productId, input.variantId);
    const unit = input.unitSalePrice ?? input.unitPrice;

    store.set((current) => {
      const existing = current.lines.find((line) => line.id === id);
      const ceiling = input.maxQuantity ?? Number.MAX_SAFE_INTEGER;

      const lines = existing
        ? current.lines.map((line) =>
            line.id === id
              ? (() => {
                  const quantity = Math.min(ceiling, line.quantity + input.quantity);
                  return { ...line, quantity, lineTotal: multiply(unit, quantity) };
                })()
              : line,
          )
        : [
            ...current.lines,
            {
              id,
              productId: input.productId,
              variantId: input.variantId,
              slug: input.slug,
              name: input.name,
              variantTitle: input.variantTitle,
              imageUrl: input.imageUrl,
              unitPrice: input.unitPrice,
              unitSalePrice: input.unitSalePrice,
              quantity: Math.min(ceiling, input.quantity),
              lineTotal: multiply(unit, Math.min(ceiling, input.quantity)),
              inStock: true,
              availableQuantity: null,
            } satisfies CartLine,
          ];

      // The basket carries one currency. Switching display currency rebases it
      // rather than mixing two, which no total could honestly add up.
      return { ...current, currency: input.currency, lines };
    });
  }, []);

  const updateQuantity = React.useCallback((id: string, quantity: number) => {
    store.set((current) => ({
      ...current,
      lines: current.lines.flatMap((line) => {
        if (line.id !== id) return [line];
        if (quantity <= 0) return [];
        const unit = line.unitSalePrice ?? line.unitPrice;
        return [{ ...line, quantity, lineTotal: multiply(unit, quantity) }];
      }),
    }));
  }, []);

  const remove = React.useCallback((id: string) => {
    store.set((current) => ({ ...current, lines: current.lines.filter((line) => line.id !== id) }));
  }, []);

  const clear = React.useCallback(() => store.set(EMPTY), []);

  /**
   * Applies a coupon, or explains why it cannot be.
   *
   * Returns a code rather than a sentence so the caller owns the wording — the
   * cart page and the checkout summary phrase the same refusal differently.
   */
  const applyCoupon = React.useCallback(
    (rawCode: string): { ok: true } | { ok: false; reason: CouponError } => {
      const code = rawCode.trim().toUpperCase();
      const current = store.get();

      if (current.lines.length === 0) return { ok: false, reason: 'empty_cart' };
      if (current.coupon?.code === code) return { ok: false, reason: 'already_applied' };

      const rule = COUPONS[code];
      if (!rule) return { ok: false, reason: 'invalid' };

      const subtotal = toMinor(sum(current.lines.map((line) => line.lineTotal)));
      if (subtotal < rule.minimum) return { ok: false, reason: 'minimum_not_met' };

      store.set({ ...current, coupon: { code, label: rule.label, discount: '0.00' } });
      return { ok: true };
    },
    [],
  );

  const removeCoupon = React.useCallback(() => {
    store.set((current) => ({ ...current, coupon: null }));
  }, []);

  const has = React.useCallback(
    (productId: string, variantId: string) =>
      stored.lines.some((line) => line.id === lineId(productId, variantId)),
    [stored.lines],
  );

  return { cart, add, updateQuantity, remove, clear, applyCoupon, removeCoupon, has };
}

/** The minimum a coupon needs, for a message that says how much more to spend. */
export function couponMinimum(code: string): number | null {
  return COUPONS[code.trim().toUpperCase()]?.minimum ?? null;
}
