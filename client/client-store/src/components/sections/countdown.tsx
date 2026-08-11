'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * A live countdown to a campaign deadline.
 *
 * Two rules this deliberately follows:
 *
 * **It tells the truth.** The deadline comes from the section's configuration
 * as an absolute moment. It is not reset on page load and it does not restart
 * when it reaches zero — a timer that resets itself is a fake scarcity signal,
 * and the design brief says not to use those.
 *
 * **It stops.** At zero the offer is over, so the component says so rather than
 * counting into negative numbers.
 *
 * The first render is a set of dashes, replaced once hydrated. The server and
 * the browser cannot agree on "now", and rendering a real time on the server
 * would guarantee a hydration mismatch on every single load.
 */

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

function remainingFrom(deadline: number): Remaining {
  const ms = deadline - Date.now();
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };

  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    done: false,
  };
}

export function Countdown({
  deadline,
  className,
  size = 'md',
  tone = 'surface',
  expiredLabel = 'This offer has ended',
}: {
  /** Epoch milliseconds. */
  deadline: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'surface' | 'primary' | 'plain';
  expiredLabel?: string;
}) {
  const hydrated = useHydrated();
  const [remaining, setRemaining] = React.useState<Remaining | null>(null);

  React.useEffect(() => {
    setRemaining(remainingFrom(deadline));
    const timer = window.setInterval(() => {
      const next = remainingFrom(deadline);
      setRemaining(next);
      if (next.done) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  if (hydrated && remaining?.done) {
    return <p className={cn('text-sm font-medium text-muted', className)}>{expiredLabel}</p>;
  }

  // Days only appear once there is at least one, so a 23-hour deal does not
  // display a permanent "00".
  const showDays = (remaining?.days ?? 0) > 0;

  const units: { label: string; short: string; value: number | null }[] = [
    ...(showDays ? [{ label: 'Days', short: 'Days', value: remaining?.days ?? null }] : []),
    { label: 'Hours', short: 'Hrs', value: remaining?.hours ?? null },
    { label: 'Minutes', short: 'Mins', value: remaining?.minutes ?? null },
    { label: 'Seconds', short: 'Secs', value: remaining?.seconds ?? null },
  ];

  return (
    <div
      className={cn('flex items-start gap-2', className)}
      // Announced once, not sixty times a minute.
      role="timer"
      aria-live="off"
    >
      {units.map((unit, index) => (
        <React.Fragment key={unit.label}>
          {index > 0 ? (
            <span
              aria-hidden
              className={cn(
                'font-semibold leading-none text-subtle',
                size === 'sm' ? 'pt-1.5 text-base' : size === 'lg' ? 'pt-2.5 text-2xl' : 'pt-2 text-xl',
              )}
            >
              :
            </span>
          ) : null}

          <span className="flex flex-col items-center">
            <span
              className={cn(
                'grid place-items-center rounded-(--radius-button) font-bold tabular-nums leading-none',
                tone === 'surface' && 'bg-surface text-foreground shadow-[var(--shadow-card)]',
                tone === 'primary' && 'bg-primary text-primary-foreground',
                tone === 'plain' && 'text-foreground',
                size === 'sm' && 'min-w-9 px-1.5 py-2 text-sm',
                size === 'md' && 'min-w-11 px-2 py-2.5 text-lg',
                size === 'lg' && 'min-w-14 px-2.5 py-3 text-2xl',
              )}
            >
              {unit.value === null ? '––' : String(unit.value).padStart(2, '0')}
            </span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
              {unit.short}
            </span>
          </span>
        </React.Fragment>
      ))}

      <span className="sr-only">
        {remaining
          ? `Offer ends in ${showDays ? `${remaining.days} days, ` : ''}${remaining.hours} hours and ${remaining.minutes} minutes.`
          : 'Loading time remaining.'}
      </span>
    </div>
  );
}
