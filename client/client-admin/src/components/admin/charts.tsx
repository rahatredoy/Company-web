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
import { useT, type MessageKey } from '@/lib/i18n';

const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID = { stroke: 'var(--border)', strokeDasharray: '3 3', vertical: false } as const;

/** `12.5%` — a percentage to one decimal, in the panel's digits. */
function percent(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(value)}%`;
}

/** `locale` is `t.locale`, so the axis reads in the panel's language. */
function shortDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
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
  const t = useT();
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-[var(--shadow-raised)]">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label ? shortDate(label, t.locale) : ''}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
          <span className="size-2 rounded-full" style={{ background: entry.color }} aria-hidden />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">
            {formatter ? formatter(entry.value ?? 0, String(entry.dataKey)) : t.number(entry.value ?? 0)}
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
  const t = useT();
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
          <XAxis dataKey="date" tickFormatter={(value: string) => shortDate(value, t.locale)} {...AXIS} minTickGap={24} />
          <YAxis
            tickFormatter={(v: number) => `$${v >= 1000 ? `${t.number(Math.round(v / 1000), { useGrouping: false })}K` : t.number(v)}`}
            {...AXIS}
            width={52}
          />
          <Tooltip
            content={<ChartTooltip formatter={(value) => t.money(value, currency)} />}
            cursor={{ stroke: 'var(--border-strong)' }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            name={t('Revenue')}
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="mrr"
            name={t('MRR')}
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
  label,
  color = 'var(--chart-2)',
}: {
  data: { date: string; total: number }[];
  label?: string;
  color?: string;
}) {
  const t = useT();
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={(value: string) => shortDate(value, t.locale)} {...AXIS} minTickGap={24} />
          <YAxis {...AXIS} width={42} allowDecimals={false} tickFormatter={(v: number) => t.number(v, { useGrouping: false })} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
          <Line
            type="monotone"
            dataKey="total"
            name={label ?? t('Clients')}
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

const STATUS_LABELS: Record<string, MessageKey> = {
  active: 'Active',
  trial: 'Trial',
  past_due: 'Past Due',
  expired: 'Expired',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export function SubscriptionDonut({ data }: { data: { status: string; count: number }[] }) {
  const t = useT();
  const total = data.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) {
    return (
      <div className="grid h-56 place-items-center text-sm text-muted-foreground">{t('No subscriptions yet')}</div>
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
                  formatter={(value) => `${t.number(value)} (${percent((value / total) * 100, t.locale)})`}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums">{t.number(total)}</p>
            <p className="text-xs text-muted-foreground">{t('Total Clients')}</p>
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
            <span className="text-muted-foreground">{STATUS_LABELS[entry.status] ? t(STATUS_LABELS[entry.status]!) : entry.status}</span>
            <span className="ml-auto font-medium tabular-nums">
              {t.number(entry.count)}{' '}
              <span className="text-muted-foreground">({percent((entry.count / total) * 100, t.locale)})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConversionBars({ data }: { data: { date: string; value: number }[] }) {
  const t = useT();
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={(value: string) => shortDate(value, t.locale)} {...AXIS} minTickGap={28} />
          <YAxis
            {...AXIS}
            width={40}
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickFormatter={(v: number) => `${t.number(v)}%`}
          />
          <Tooltip
            content={<ChartTooltip formatter={(value) => percent(value, t.locale)} />}
            cursor={{ fill: 'var(--muted)' }}
          />
          <Bar dataKey="value" name={t('Conversion')} fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
