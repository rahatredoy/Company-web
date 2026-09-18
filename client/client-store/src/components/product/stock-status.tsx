'use client';

import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Availability, stated in words.
 *
 * Colour carries the same meaning as the text, never instead of it — an icon
 * and a sentence, so a red dot alone is never the only signal that something is
 * unavailable.
 *
 * `remaining` is a coarse hint from the server, not a warehouse count. It is
 * shown only when it is genuinely low, because "only 3 left" attached to a
 * permanent stock of hundreds is the sort of manufactured urgency the design
 * brief rules out.
 */
export function StockStatus({
  inStock,
  lowStock,
  remaining,
  className,
}: {
  inStock: boolean;
  lowStock?: boolean;
  remaining?: number | null;
  className?: string;
}) {
  const t = useT();

  if (!inStock) {
    return (
      <p className={cn('flex items-center gap-2 text-sm font-medium text-error', className)}>
        <XCircle className="size-4 shrink-0" aria-hidden />
        {t('Out of stock')}
      </p>
    );
  }

  if (lowStock) {
    return (
      <p className={cn('flex items-center gap-2 text-sm font-medium text-warning', className)}>
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {remaining && remaining > 0 ? t('Only {count} left in stock', { count: remaining }) : t('Low stock')}
      </p>
    );
  }

  return (
    <p className={cn('flex items-center gap-2 text-sm font-medium text-success', className)}>
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      {t('In stock')}
    </p>
  );
}
