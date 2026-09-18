'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DASHBOARD_GRANULARITIES,
  DASHBOARD_RANGES,
  formatDashboardRange,
} from '@/lib/dashboard';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DashboardGranularity } from '@/lib/types';

/**
 * The window and the bucket size, both held in the URL.
 *
 * They live in the query string rather than in component state so the figures
 * stay shareable and survive a reload — and because the page is a server
 * component reading its own `searchParams`, which means the numbers are fetched
 * for the chosen window rather than filtered in the browser from a wider set
 * that would have to be fetched anyway.
 */

/**
 * Keeps every other search param while replacing one.
 *
 * Written as a replace rather than a push: flicking between ranges is looking at
 * one screen, not visiting five, and leaving each step in history means Back
 * walks the reader out one range at a time instead of off the page.
 */
function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const set = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [params, pathname, router],
  );

  return { set, pending };
}

function TriggerButton({
  children,
  pending,
  icon,
  className,
}: {
  children: React.ReactNode;
  pending: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenuTrigger
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium shadow-xs transition-colors',
        'hover:bg-muted focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none',
        pending && 'opacity-60',
        className,
      )}
      aria-busy={pending || undefined}
    >
      {icon}
      {children}
      <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
    </DropdownMenuTrigger>
  );
}

/**
 * `from`/`to`/`timezone` are optional because they come from the API, and the
 * picker has to keep working when the API did not answer — that is the moment a
 * reader most wants to try another range. Without them it shows the preset's own
 * label rather than a date range worked out locally, which would be a different
 * window from the one the figures were computed for.
 */
export function RangePicker({
  days,
  from,
  to,
  timezone,
}: {
  days: number;
  from?: string;
  to?: string;
  timezone?: string;
}) {
  const t = useT();
  const { set, pending } = useSetParam();
  const preset = DASHBOARD_RANGES.find((range) => range.days === days);
  const label =
    from && to && timezone
      ? formatDashboardRange(from, to, timezone, t.locale)
      : preset
        ? t(preset.label)
        : t('{count} days', { count: days });

  return (
    <DropdownMenu>
      <TriggerButton pending={pending} icon={<CalendarDays className="size-4 text-muted-foreground" aria-hidden />}>
        <span className="tabular-nums">{label}</span>
      </TriggerButton>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t('Date range')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DASHBOARD_RANGES.map((range) => (
          <DropdownMenuItem
            key={range.days}
            onSelect={() => set('days', String(range.days))}
            className="justify-between"
          >
            {t(range.label)}
            {range.days === days ? <Check className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GranularityPicker({ granularity }: { granularity: DashboardGranularity }) {
  const t = useT();
  const { set, pending } = useSetParam();
  const current =
    DASHBOARD_GRANULARITIES.find((item) => item.key === granularity) ?? DASHBOARD_GRANULARITIES[0]!;

  return (
    <DropdownMenu>
      <TriggerButton pending={pending}>{t(current.label)}</TriggerButton>
      <DropdownMenuContent align="end" className="w-36">
        {DASHBOARD_GRANULARITIES.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={() => set('granularity', item.key)} className="justify-between">
            {t(item.label)}
            {item.key === granularity ? <Check className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
