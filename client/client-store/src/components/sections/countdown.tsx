'use client';

import * as React from 'react';
import { useT } from '@/lib/i18n';
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

/**
 * One interval for every countdown on the page, read through
 * `useSyncExternalStore` the same way `useHydrated` reads hydration. The clock
 * is genuinely an external source — subscribing to it is how React is told
 * about it, and it keeps the first value out of an effect, which would have
 * rendered the dashes and then immediately re-rendered over them.
 */
const tickListeners = new Set<() => void>();
let tickTimer: number | undefined;

function subscribeToSecond(onChange: () => void): () => void {
  tickListeners.add(onChange);
  tickTimer ??= window.setInterval(() => {
    for (const listener of tickListeners) listener();
  }, 1000);

  return () => {
    tickListeners.delete(onChange);
    if (tickListeners.size === 0 && tickTimer !== undefined) {
      window.clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
}

// Whole seconds, so the snapshot is a primitive that only changes once a second
// rather than on every comparison React makes.
const readSecond = () => Math.floor(Date.now() / 1000);
const readSecondOnServer = () => 0;

function remainingFrom(deadline: number, now: number): Remaining {
  const ms = deadline - now;
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
  expiredLabel,
}: {
  /** Epoch milliseconds. */
  deadline: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'surface' | 'primary' | 'plain';
  expiredLabel?: string;
}) {
  const t = useT();
  const hydrated = useHydrated();
  const second = React.useSyncExternalStore(subscribeToSecond, readSecond, readSecondOnServer);
  const remaining = hydrated ? remainingFrom(deadline, second * 1000) : null;

  if (hydrated && remaining?.done) {
    return (
      <p className={cn('text-sm font-medium text-muted', className)}>
        {expiredLabel ?? t('This offer has ended')}
      </p>
    );
  }

  // Days only appear once there is at least one, so a 23-hour deal does not
  // display a permanent "00".
  const showDays = (remaining?.days ?? 0) > 0;

  const units: { key: string; short: string; value: number | null }[] = [
    ...(showDays ? [{ key: 'days', short: t('Days'), value: remaining?.days ?? null }] : []),
    { key: 'hours', short: t('Hrs'), value: remaining?.hours ?? null },
    { key: 'minutes', short: t('Mins'), value: remaining?.minutes ?? null },
    { key: 'seconds', short: t('Secs'), value: remaining?.seconds ?? null },
  ];

  return (
    <div
      className={cn('flex items-start gap-2', className)}
      // Announced once, not sixty times a minute.
      role="timer"
      aria-live="off"
    >
      {units.map((unit, index) => (
        <React.Fragment key={unit.key}>
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
              {unit.value === null
                ? '––'
                : t.number(unit.value, { minimumIntegerDigits: 2, useGrouping: false })}
            </span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
              {unit.short}
            </span>
          </span>
        </React.Fragment>
      ))}

      <span className="sr-only">
        {remaining
          ? showDays
            ? t('Offer ends in {days} days, {hours} hours and {minutes} minutes.', {
                days: remaining.days,
                hours: remaining.hours,
                minutes: remaining.minutes,
              })
            : t('Offer ends in {hours} hours and {minutes} minutes.', {
                hours: remaining.hours,
                minutes: remaining.minutes,
              })
          : t('Loading time remaining.')}
      </span>
    </div>
  );
}
