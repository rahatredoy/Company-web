'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const RANGE_OPTIONS = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '3m', label: '3 Months' },
  { value: '6m', label: '6 Months' },
  { value: '1y', label: '1 Year' },
  { value: 'custom', label: 'Custom' },
] as const;

export type RangeValue = (typeof RANGE_OPTIONS)[number]['value'];

/** `YYYY-MM-DD`, which is what a native date input both wants and produces. */
function toDateInput(value: string | null, fallbackDaysAgo: number): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - fallbackDaysAgo);
  return date.toISOString().slice(0, 10);
}

export function RangeSelect({
  param = 'range',
  value,
  className,
}: {
  param?: string;
  value: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from, setFrom] = React.useState(() => toDateInput(searchParams.get('from'), 30));
  const [to, setTo] = React.useState(() => toDateInput(searchParams.get('to'), 0));

  const push = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`${pathname}?${params.toString()}`);
  };

  const changeRange = (next: string) => {
    push((params) => {
      params.set(param, next);
      if (next === 'custom') {
        // Seed the window so the first render of Custom already shows real data.
        params.set('from', from);
        params.set('to', to);
      } else {
        params.delete('from');
        params.delete('to');
      }
    });
  };

  const changeDate = (which: 'from' | 'to', next: string) => {
    if (!next) return;
    if (which === 'from') setFrom(next);
    else setTo(next);

    push((params) => {
      params.set(param, 'custom');
      params.set('from', which === 'from' ? next : from);
      params.set('to', which === 'to' ? next : to);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value === 'custom' ? (
        <>
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(event) => changeDate('from', event.target.value)}
            aria-label="From date"
            className="h-9 w-40"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(event) => changeDate('to', event.target.value)}
            aria-label="To date"
            className="h-9 w-40"
          />
        </>
      ) : null}

      <Select value={value} onValueChange={changeRange}>
        <SelectTrigger className={className ?? 'h-9 w-36'} aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
