import type { ProductSummary } from '@/types';

/**
 * Demonstration currency conversion, for the fixture layer only.
 *
 * A real deployment never runs this. The storefront sends the visitor's display
 * preference to the Commerce API and receives prices already in that currency,
 * converted against rates the platform actually holds and can honour.
 *
 * This exists so the currency selector is a control that visibly does something
 * while the commerce endpoints are still being built. The rates are fixed and
 * approximate, and they are wrong the day after they were written — which is
 * exactly why the real thing does not live in the frontend.
 */

const RATES: Record<string, number> = {
  USD: 1,
  BDT: 118,
  EUR: 0.92,
  GBP: 0.79,
  INR: 84,
};

const BASE = 'USD';

export function isConvertible(currency: string): boolean {
  return currency in RATES;
}

function convertAmount(amount: string, from: string, to: string): string {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return amount;

  const fromRate = RATES[from];
  const toRate = RATES[to];
  if (!fromRate || !toRate) return amount;

  const converted = (value / fromRate) * toRate;
  // Currencies with a large unit value read badly with decimals attached.
  return toRate >= 50 ? String(Math.round(converted)) : converted.toFixed(2);
}

export function convertProduct(product: ProductSummary, to: string): ProductSummary {
  if (to === product.currency || !isConvertible(to) || !isConvertible(product.currency)) {
    return product;
  }

  return {
    ...product,
    price: convertAmount(product.price, product.currency, to),
    salePrice: product.salePrice ? convertAmount(product.salePrice, product.currency, to) : null,
    currency: to,
  };
}

export function convertProducts(products: ProductSummary[], to: string | null): ProductSummary[] {
  if (!to || to === BASE) return products;
  return products.map((product) => convertProduct(product, to));
}

/**
 * Converts anything carrying a price and a currency.
 *
 * `ProductDetail` is not a `ProductSummary` — it drops the two image fields —
 * so it cannot go through `convertProduct` without a cast that lies about the
 * shape. This works on the three fields that actually matter and leaves the
 * rest of the object alone.
 */
export function convertPriced<T extends { price: string; salePrice: string | null; currency: string }>(
  item: T,
  to: string | null,
): T {
  if (!to || to === item.currency || !isConvertible(to) || !isConvertible(item.currency)) {
    return item;
  }

  return {
    ...item,
    price: convertAmount(item.price, item.currency, to),
    salePrice: item.salePrice ? convertAmount(item.salePrice, item.currency, to) : null,
    currency: to,
  };
}
