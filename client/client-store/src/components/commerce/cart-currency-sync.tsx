'use client';

import { useSyncCartCurrency } from '@/lib/commerce/cart';

/**
 * Renders nothing; mounted once by the root layout, which is the one place that
 * knows the store's currency on every page. See `useSyncCartCurrency`.
 */
export function CartCurrencySync({ currency }: { currency: string }) {
  useSyncCartCurrency(currency);
  return null;
}
