'use client';

import { useT } from '@/lib/i18n';

/**
 * Tiny inline sparkline. Hand-drawn SVG instead of a chart library so the KPI
 * row stays cheap to render and is drawn in the server's HTML.
 *
 * A client component only for its accessible label, which is in the store's
 * language: every prop is plain data, so the server-rendered `KpiCard` can still
 * hand it over, and it renders on the server like any other.
 */
export function Sparkline({
  data,
  color = 'var(--chart-1)',
  width = 220,
  height = 44,
  className,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const t = useT();
  if (!data || data.length < 2) {
    return <div className={className} style={{ height }} aria-hidden />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 4;
  const usable = height - pad * 2;

  const points = data.map((value, index) => {
    const x = index * stepX;
    const y = pad + usable - ((value - min) / span) * usable;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, '')}-${data.length}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height }}
      role="img"
      aria-label={t('Trend over the selected period')}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
