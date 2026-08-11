import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Money is formatted, never calculated, in this app — the server is the only
 * authority on price. Values arrive as decimal strings so they never round-trip
 * through a float on the way here.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: string,
  locale = 'en-US',
): string {
  const value = typeof amount === 'string' ? Number.parseFloat(amount) : (amount ?? 0);
  const safe = Number.isFinite(value) ? value : 0;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      /*
       * The narrow symbol, not the code. `BDT 35,282` is nearly twice the width
       * of `৳35,282`, and on a six-across product grid that difference is what
       * wraps a sale price onto a second line — which then stretches every card
       * in the row. It is also simply how prices are written here.
       *
       * Currencies with no narrow symbol fall back to the code on their own, so
       * nothing is lost where there is nothing shorter to use.
       */
      currencyDisplay: 'narrowSymbol',
      // Whole amounts read better without trailing zeros on a storefront.
      minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    // An unrecognised currency code must not blank out a price.
    return `${currency} ${safe.toFixed(2)}`;
  }
}

export function formatDate(value: string | Date | null | undefined, locale = 'en-US'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function discountPercent(price: string, salePrice: string | null): number | null {
  if (!salePrice) return null;
  const full = Number.parseFloat(price);
  const sale = Number.parseFloat(salePrice);
  if (!Number.isFinite(full) || !Number.isFinite(sale) || full <= 0 || sale >= full) return null;
  return Math.round(((full - sale) / full) * 100);
}

/**
 * Only ever produce a same-site destination from a user-supplied `next` param.
 * Redirecting to an arbitrary URL from a query string is an open redirect and a
 * ready-made phishing vector on a login page.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/account'): string {
  if (!value) return fallback;
  // A leading `//` is protocol-relative and would leave the site.
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

/** Truncates on a word boundary, for card titles and meta descriptions. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** Builds a listing URL without losing the filters already applied. */
export function withSearchParams(
  pathname: string,
  current: URLSearchParams | Record<string, string | undefined>,
  changes: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams(
    current instanceof URLSearchParams ? current : (current as Record<string, string>),
  );

  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }

  // Changing a filter must always send the visitor back to the first page.
  if (!('page' in changes)) params.delete('page');

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
