import type { DashboardGranularity } from './types';

/**
 * What the dashboard's two controls offer, and how their values are read back.
 *
 * Kept out of `components/admin/dashboard-filters.tsx` on purpose. That file is
 * `'use client'`, and **every** export of a client module becomes a client
 * reference when a server component imports it — the array arrives as an opaque
 * proxy, so `RANGES.some(...)` throws at render rather than at build. The page
 * validates its own search params against these, so they have to live somewhere
 * both sides can genuinely read.
 */

export const DASHBOARD_RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
] as const;

export const DASHBOARD_GRANULARITIES: { key: DashboardGranularity; label: string }[] = [
  { key: 'day', label: 'Daily' },
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
];

export const DEFAULT_DASHBOARD_DAYS = 7;

/** The `?days=` in the URL, or the default — never a window the API would reject. */
export function resolveDays(raw: string | undefined): number {
  const days = Number(raw);
  return DASHBOARD_RANGES.some((range) => range.days === days) ? days : DEFAULT_DASHBOARD_DAYS;
}

export function resolveGranularity(raw: string | undefined): DashboardGranularity {
  return DASHBOARD_GRANULARITIES.some((item) => item.key === raw)
    ? (raw as DashboardGranularity)
    : 'day';
}

/**
 * `Aug 8 – Aug 14, 2025`, with the year said once when both ends share it.
 *
 * Rendered in the **store's** timezone, which the API reports alongside the
 * window it used. Formatting in the reader's own zone instead would put a date
 * on the label that the figures underneath it were not computed for — a shop in
 * Dhaka read from London would be told its week ended a day later than it did.
 * Server and browser therefore agree, which is also what keeps hydration quiet.
 */
export function formatDashboardRange(from: string, to: string, timeZone: string): string {
  const start = new Date(from);
  // The API's `to` is exclusive — the instant the window ends. The reader means
  // the last day *in* it, so a second comes off before it is shown.
  const end = new Date(new Date(to).getTime() - 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';

  // `timeZone` comes from the store's own settings and may be anything; an
  // unknown name makes `Intl` throw, and a label is not worth a broken page.
  const zone = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      return new Intl.DateTimeFormat('en-US', options);
    }
  };

  const year = (date: Date) => zone({ year: 'numeric' }).format(date);
  const sameYear = year(start) === year(end);

  const head = zone({
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(start);
  const tail = zone({ month: 'short', day: 'numeric', year: 'numeric' }).format(end);

  return `${head} – ${tail}`;
}
