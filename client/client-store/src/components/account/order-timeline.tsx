import { Check } from 'lucide-react';
import type { OrderTimelineEntry } from '@/types';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * Order progress.
 *
 * An ordered list, because that is what it is: steps in sequence, some done.
 * State is carried by a tick and by the word "Completed" in the accessible
 * text, not by the colour of a dot — a colour-only timeline tells a
 * colour-blind customer nothing about where their parcel is.
 *
 * Steps a cancelled or returned order never reached are simply not marked
 * reached; the server decides which those are.
 */
export function OrderTimeline({
  timeline,
  locale,
  className,
}: {
  timeline: OrderTimelineEntry[];
  locale: string;
  className?: string;
}) {
  if (timeline.length === 0) return null;

  const currentIndex = timeline.reduce(
    (latest, entry, index) => (entry.reached ? index : latest),
    0,
  );

  return (
    <ol className={cn('relative space-y-0', className)}>
      {timeline.map((entry, index) => {
        const isCurrent = index === currentIndex;
        const isLast = index === timeline.length - 1;

        return (
          <li key={entry.status} className="relative flex gap-3 pb-6 last:pb-0">
            {/* The connector stops at the last step rather than trailing off. */}
            {!isLast ? (
              <span
                aria-hidden
                className={cn(
                  'absolute left-3 top-6 h-full w-px -translate-x-1/2',
                  entry.reached ? 'bg-primary' : 'bg-border',
                )}
              />
            ) : null}

            <span
              aria-hidden
              className={cn(
                'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2',
                entry.reached
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface',
              )}
            >
              {entry.reached ? <Check className="size-3.5" /> : null}
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn('text-sm', isCurrent ? 'font-semibold' : 'font-medium')}>
                {entry.label}
                <span className="sr-only">
                  {entry.reached ? ' — completed' : ' — not yet reached'}
                </span>
              </p>

              {entry.at ? (
                <time dateTime={entry.at} className="text-xs text-subtle">
                  {formatDate(entry.at, locale)}
                </time>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
