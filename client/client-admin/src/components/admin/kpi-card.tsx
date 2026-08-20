import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/utils';
import type { MetricDelta } from '@/lib/types';

export function KpiCard({
  label,
  value,
  metric,
  icon: Icon,
  tint = 'primary',
  /** Set when a rise is bad (failed payments, suspensions). */
  invertTrend = false,
  showSpark = true,
  compareLabel = 'vs last 30 days',
  /**
   * `stacked` puts the trend under the figure; `inline` sets it beside, which is
   * what keeps four cards to one row-height when the dashboard shows them next
   * to a chart. Presentation only — same data either way.
   */
  align = 'stacked',
  /**
   * Shown in place of the comparison line. For a figure that has no previous
   * period to compare against — a live stock count — this is where the second
   * fact that *is* worth knowing goes, rather than "no comparison data".
   */
  hint,
}: {
  label: string;
  value: string;
  metric?: MetricDelta;
  icon: LucideIcon;
  tint?: 'primary' | 'success' | 'warning' | 'info' | 'danger';
  invertTrend?: boolean;
  showSpark?: boolean;
  compareLabel?: string;
  align?: 'stacked' | 'inline';
  hint?: React.ReactNode;
}) {
  const change = metric?.changePct ?? null;
  const rising = (change ?? 0) >= 0;
  const good = invertTrend ? !rising : rising;

  const tints = {
    primary: { badge: 'bg-primary-soft text-accent-foreground', line: 'var(--chart-1)' },
    success: { badge: 'bg-success-soft text-success', line: 'var(--chart-3)' },
    warning: { badge: 'bg-warning-soft text-warning', line: 'var(--chart-4)' },
    info: { badge: 'bg-info-soft text-info', line: 'var(--chart-2)' },
    danger: { badge: 'bg-destructive-soft text-destructive', line: 'var(--chart-5)' },
  } as const;

  const spark =
    showSpark && metric?.spark?.length ? (
      <Sparkline
        data={metric.spark}
        color={tints[tint].line}
        height={align === 'inline' ? 40 : 44}
        className={align === 'inline' ? 'w-28 shrink-0 sm:w-32' : '-mx-1 w-[calc(100%+0.5rem)]'}
      />
    ) : null;

  const trend =
    change === null ? (
      <p className="text-xs text-muted-foreground">{hint ?? 'No comparison data'}</p>
    ) : (
      <p
        className={cn(
          'flex flex-wrap items-center gap-1 text-xs font-medium',
          good ? 'text-success' : 'text-destructive',
        )}
      >
        {rising ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
        {Math.abs(change).toFixed(1)}%
        <span className="font-normal text-muted-foreground">{compareLabel}</span>
      </p>
    );

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', tints[tint].badge)}>
            <Icon className="size-4.5" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>

        {align === 'inline' ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
              {spark}
            </div>
            {trend}
          </>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
            {trend}
            {spark}
          </>
        )}
      </CardContent>
    </Card>
  );
}
