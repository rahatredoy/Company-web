'use client';

import * as React from 'react';
import type { Cart, CartLine, CartTotals } from '@/types';
import { createPersistedStore } from './persisted-store';
import { multiply, subtract, sum } from './money';

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
  /**
   * Which size, for a product sold by weight or volume.
   *
   * `unitPrice` above is then the price of one of *these* — one 500gm bag —
   * rather than the shelf rate, because that is what the quantity below
   * multiplies and what the basket has to total.
   */
  measureLabel?: string | null;
  measure?: number | null;
}

interface StoredCart {
  currency: string;
  lines: CartLine[];
  coupon: { code: string; label: string | null; discount: string } | null;
}

const EMPTY: StoredCart = { currency: 'USD', lines: [], coupon: null };

export type CouponResult = { ok: true } | { ok: false; message: string };

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

/**
 * What makes two basket lines the same line.
 *
 * The size is part of it. A product sold by weight has one variant and one
 * price, so keying on the variant alone would have merged 500gm and 1kg of the
 * same thing into a single line — one of the two sizes silently becoming the
 * other, at the other's price. Null for an ordinary product, which keeps every
 * existing line's id exactly what it was.
 */
const lineId = (productId: string, variantId: string, measure?: number | null) =>
  measure ? `${productId}::${variantId}::${measure}` : `${productId}::${variantId}`;

function computeTotals(cart: StoredCart): CartTotals {
  const subtotal = sum(cart.lines.map((line) => line.lineTotal));

  /*
   * The discount is the figure the store returned when the code was applied,
   * never one worked out here — this app deliberately holds no copy of the
   * coupon rules. It is clamped to the subtotal so that editing the basket after
   * applying a code can only ever make the estimate too small, never negative.
   *
   * Checkout re-derives all of it from the database, and that is the number
   * charged; like the shipping line above, this is an estimate and the page says
   * so.
   */
  const claimed = cart.coupon?.discount ?? '0.00';
  const discount = Number(claimed) > Number(subtotal) ? subtotal : claimed;

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
    const id = lineId(input.productId, input.variantId, input.measure);
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
              measureLabel: input.measureLabel ?? null,
              measure: input.measure ?? null,
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
   * The rules live on the server and the refusal sentence comes back with the
   * answer, because the reasons are the store's own — a minimum spend, a usage
   * cap, a campaign that has not started. Phrasing them here would mean keeping
   * a copy of rules this app deliberately does not have.
   *
   * The two checks that stay local are the two the server cannot see: an empty
   * basket, and a code that is already on it.
   */
  const applyCoupon = React.useCallback(async (rawCode: string): Promise<CouponResult> => {
    const code = rawCode.trim().toUpperCase();
    const current = store.get();

    if (current.lines.length === 0) return { ok: false, message: 'Add something to your basket first.' };
    if (current.coupon?.code === code) return { ok: false, message: 'That code is already applied.' };

    const subtotal = Number(sum(current.lines.map((line) => line.lineTotal)));

    let body: {
      data?: { valid?: boolean; message?: string; label?: string | null; discount?: string };
    } | null = null;
    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotal }),
      });
      body = await response.json().catch(() => null);
    } catch {
      return { ok: false, message: 'We could not check that code. Try again in a moment.' };
    }

    if (!body?.data?.valid) {
      return { ok: false, message: body?.data?.message ?? 'That code is not valid.' };
    }

    store.set({
      ...store.get(),
      coupon: { code, label: body.data.label ?? null, discount: body.data.discount ?? '0.00' },
    });
    return { ok: true };
  }, []);

  const removeCoupon = React.useCallback(() => {
    store.set((current) => ({ ...current, coupon: null }));
  }, []);

  const has = React.useCallback(
    (productId: string, variantId: string, measure?: number | null) =>
      stored.lines.some((line) => line.id === lineId(productId, variantId, measure)),
    [stored.lines],
  );

  return { cart, add, updateQuantity, remove, clear, applyCoupon, removeCoupon, has };
}
