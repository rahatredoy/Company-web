/**
 * A money figure in the store's currency — whatever Settings says that is.
 *
 * The narrow symbol, the way the storefront prints it: `৳1,299` rather than
 * `BDT 1,299`, so the owner reads the same figure in the panel that their
 * shoppers read on the shelf. `en-US` alone would give Taka no symbol at all.
 * A currency with nothing shorter than its code falls back to the code.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency = 'USD',
  locale = 'en-US',
): string {
  if (amount === null || amount === undefined) return '—';
  const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // A code this browser's Intl does not accept must not blank out a price —
    // or, worse, throw inside a server component and take the page with it.
    return `${currency} ${value.toFixed(Number.isInteger(value) ? 0 : 2)}`;
  }
}

export function formatNumber(
  value: number | null | undefined,
  locale = 'en-US',
  options?: Intl.NumberFormatOptions,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, options).format(value);
}

/*
 * Every formatter takes the `Intl` locale last and defaults to the `en-US` the
 * panel always printed in. Screens reach them through the translator — `t.date`,
 * `t.money` — which passes the store's own, so a Bangla panel reads "১৪ সেপ,
 * ২০২৬" beside its own words rather than an English date.
 */
export function formatDate(input: string | Date | null | undefined, locale = 'en-US'): string {
  if (!input) return '—';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatDateTime(input: string | Date | null | undefined, locale = 'en-US'): string {
  if (!input) return '—';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatRelative(input: string | Date | null | undefined, locale = 'en-US'): string {
  if (!input) return '—';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(diffSeconds, 'second');
}

/** Whole days left, floored at 0 — used for trial countdowns. */
export function daysUntil(input: string | Date | null | undefined): number {
  if (!input) return 0;
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
