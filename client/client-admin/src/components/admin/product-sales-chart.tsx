'use client';

import * as React from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useT } from '@/lib/i18n';

/**
 * One product's takings, day by day.
 *
 * Two series on one pair of axes, because the question an owner is asking is
 * whether the money followed the units — a good day for revenue that was a quiet
 * day for volume is a discount that did not need to be given, and neither series
 * shows that alone. Units are bars and revenue is a filled line, so the two are
 * never confused for each other at a glance; they carry their own axes because
 * one is a count of ten and the other a sum of thousands.
 *
 * The series arrives gap-free from the API — generated from a calendar in the
 * store's own timezone and left-joined — so a quiet day is a zero here rather
 * than a missing point. That matters more than it sounds: a chart that closes
 * the gap draws a smooth trend across days that never happened.
 */

const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function dayLabel(value: string, locale: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

/** `$2.5K`, `$1.2M` — an axis needs the size, never the cents. */
function compactMoney(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function ProductSalesChart({
  data,
  currency,
}: {
  data: { bucket: string; units: number; revenue: string }[];
  currency: string;
}) {
  const t = useT();
  const points = React.useMemo(
    () => data.map((row) => ({ ...row, revenue: Number(row.revenue) || 0 })),
    [data],
  );

  const sold = points.reduce((sum, point) => sum + point.units, 0);

  /*
   * Empty is its own state rather than a flat line at zero. A chart drawn
   * against no sales looks like a chart of a bad week, and the two need
   * different actions from whoever is reading it.
   */
  if (points.length === 0 || sold === 0) {
    return (
      <div className="grid h-56 place-items-center rounded-lg border border-dashed text-center">
        <div className="px-6">
          <p className="text-sm font-medium">{t('Nothing sold in this period')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Sales appear here on the day the order is placed. Try a wider range.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="productRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={(value: string) => dayLabel(value, t.locale)}
            minTickGap={24}
            {...AXIS}
          />
          <YAxis
            yAxisId="units"
            allowDecimals={false}
            width={34}
            {...AXIS}
          />
          <YAxis
            yAxisId="revenue"
            orientation="right"
            tickFormatter={(value: number) => compactMoney(value, currency, t.locale)}
            width={56}
            {...AXIS}
          />

          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as { units: number; revenue: number };
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-[var(--shadow-raised)]">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {dayLabel(String(label), t.locale)}
                  </p>
                  <p className="text-sm font-semibold tabular-nums">
                    {t.plural(point.units, '{count} unit', '{count} units')}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t.money(point.revenue, currency)}
                  </p>
                </div>
              );
            }}
          />

          <Bar yAxisId="units" dataKey="units" name={t('Units')} fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
          <Area
            yAxisId="revenue"
            type="monotone"
            dataKey="revenue"
            name={t('Revenue')}
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#productRevenueFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
