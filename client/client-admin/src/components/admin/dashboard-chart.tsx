'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatNumber } from '@/lib/format';
import type { DashboardGranularity } from '@/lib/types';

const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

/**
 * How a bucket's start date reads on the axis.
 *
 * A weekly bucket is labelled by the day it opens rather than "week 33": nobody
 * counts weeks, and the reader is matching the point against something that
 * happened on a date.
 */
function bucketLabel(value: string, granularity: DashboardGranularity): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    'en-US',
    granularity === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' },
  ).format(date);
}

/** `$2.5k`, `$1.2M` — the axis needs the size, not the cents. */
function compactMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function SalesOverview({
  data,
  currency,
  granularity,
}: {
  data: { bucket: string; orders: number; revenue: string }[];
  currency: string;
  granularity: DashboardGranularity;
}) {
  const points = React.useMemo(
    () => data.map((row) => ({ ...row, revenue: Number(row.revenue) })),
    [data],
  );

  const takings = points.reduce((sum, point) => sum + point.revenue, 0);

  if (points.length === 0 || takings === 0) {
    return (
      <div className="grid h-64 place-items-center rounded-lg border border-dashed text-center">
        <div className="px-6">
          <p className="text-sm font-medium">No sales in this period</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Orders appear here the day they are placed. Try a wider date range.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={(value: string) => bucketLabel(value, granularity)}
            minTickGap={20}
            {...AXIS}
          />
          <YAxis
            tickFormatter={(value: number) => compactMoney(value, currency)}
            width={58}
            {...AXIS}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as { revenue: number; orders: number };
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-[var(--shadow-raised)]">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {bucketLabel(String(label), granularity)}
                  </p>
                  <p className="text-sm font-semibold tabular-nums">{formatMoney(point.revenue, currency)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatNumber(point.orders)} order{point.orders === 1 ? '' : 's'}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Revenue"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#salesFill)"
            dot={points.length <= 14 ? { r: 3, strokeWidth: 0, fill: 'var(--chart-1)' } : false}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
