'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatNumber } from '@/lib/format';

const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID = { stroke: 'var(--border)', strokeDasharray: '3 3', vertical: false } as const;

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string | number; value?: number; color?: string }[];
  label?: string;
  formatter?: (value: number, key: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-[var(--shadow-raised)]">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label ? shortDate(label) : ''}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
          <span className="size-2 rounded-full" style={{ background: entry.color }} aria-hidden />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">
            {formatter ? formatter(entry.value ?? 0, String(entry.dataKey)) : formatNumber(entry.value ?? 0)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function RevenueChart({
  data,
  currency = 'USD',
}: {
  data: { date: string; revenue: number; mrr: number }[];
  currency?: string;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}K` : v}`} {...AXIS} width={52} />
          <Tooltip
            content={<ChartTooltip formatter={(value) => formatMoney(value, currency)} />}
            cursor={{ stroke: 'var(--border-strong)' }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Revenue"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="mrr"
            name="MRR"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GrowthChart({
  data,
  label = 'Clients',
  color = 'var(--chart-2)',
}: {
  data: { date: string; total: number }[];
  label?: string;
  color?: string;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={24} />
          <YAxis {...AXIS} width={42} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
          <Line
            type="monotone"
            dataKey="total"
            name={label}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: color }}
            activeDot={{ r: 4.5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--chart-3)',
  trial: 'var(--chart-4)',
  past_due: 'var(--chart-5)',
  expired: 'var(--chart-1)',
  suspended: 'var(--chart-2)',
  cancelled: 'var(--muted-foreground)',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  trial: 'Trial',
  past_due: 'Past Due',
  expired: 'Expired',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export function SubscriptionDonut({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) {
    return (
      <div className="grid h-56 place-items-center text-sm text-muted-foreground">No subscriptions yet</div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row">
      <div className="relative h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius="66%"
              outerRadius="98%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? 'var(--muted-foreground)'} />
              ))}
            </Pie>
            <Tooltip
              content={
                <ChartTooltip
                  formatter={(value) => `${formatNumber(value)} (${((value / total) * 100).toFixed(1)}%)`}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums">{formatNumber(total)}</p>
            <p className="text-xs text-muted-foreground">Total Clients</p>
          </div>
        </div>
      </div>

      <ul className="w-full space-y-2.5">
        {data.map((entry) => (
          <li key={entry.status} className="flex items-center gap-2.5 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: STATUS_COLORS[entry.status] ?? 'var(--muted-foreground)' }}
              aria-hidden
            />
            <span className="text-muted-foreground">{STATUS_LABELS[entry.status] ?? entry.status}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatNumber(entry.count)}{' '}
              <span className="text-muted-foreground">({((entry.count / total) * 100).toFixed(1)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConversionBars({ data }: { data: { date: string; value: number }[] }) {
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={28} />
          <YAxis
            {...AXIS}
            width={40}
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            content={<ChartTooltip formatter={(value) => `${value.toFixed(1)}%`} />}
            cursor={{ fill: 'var(--muted)' }}
          />
          <Bar dataKey="value" name="Conversion" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
