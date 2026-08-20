'use client';

import * as React from 'react';
import { Crown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { platformUrl } from '@/lib/env';

const KEY = 'dashboard.trial-banner.dismissed-at-days';

/**
 * `localStorage` as an external store, which is what it is.
 *
 * Reading it in an effect and calling `setState` would work, but it makes the
 * value React state that happens to start from the browser — two sources for one
 * fact, and a cascading render on every mount. `useSyncExternalStore` instead
 * gives the server a snapshot of its own (`null`, so the banner is rendered) and
 * lets React swap in the browser's answer during hydration without a mismatch.
 */
const listeners = new Set<() => void>();
let cached: number | null = null;
let read = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Must return a stable reference between renders, hence the module-level cache. */
function snapshot(): number | null {
  if (!read) {
    const stored = window.localStorage.getItem(KEY);
    cached = stored === null ? null : Number(stored);
    read = true;
  }
  return cached;
}

function dismiss(days: number): void {
  window.localStorage.setItem(KEY, String(days));
  cached = days;
  read = true;
  for (const listener of listeners) listener();
}

/**
 * The one thing an owner must not miss, and the one banner they may put away.
 *
 * Dismissal is remembered against the **day count**, not as a flag: closing it
 * with 27 days left hides it until there are 26, so a countdown that is getting
 * shorter keeps saying so instead of being silenced once and for all. The store
 * stops trading when a trial lapses, so a banner that could be permanently
 * dismissed would be a way to lose a shop by accident.
 *
 * Nothing here decides anything. Billing lives on the platform account, which
 * this panel holds no session for, so the button is a link out.
 */
export function TrialBanner({ daysRemaining }: { daysRemaining: number }) {
  const dismissedAt = React.useSyncExternalStore(subscribe, snapshot, () => null);

  if (dismissedAt !== null && Number.isFinite(dismissedAt) && daysRemaining >= dismissedAt) return null;

  const days = Math.max(0, daysRemaining);
  const urgent = days <= 3;

  return (
    <Card
      className={
        urgent
          ? 'flex flex-wrap items-center gap-4 border-destructive/40 bg-destructive-soft/50 p-4'
          : 'flex flex-wrap items-center gap-4 border-warning/40 bg-warning-soft/50 p-4'
      }
    >
      <span
        className={
          urgent
            ? 'grid size-10 shrink-0 place-items-center rounded-xl bg-destructive-soft text-destructive'
            : 'grid size-10 shrink-0 place-items-center rounded-xl bg-warning-soft text-warning'
        }
      >
        <Crown className="size-5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {days === 0
            ? 'Your trial ends today'
            : `Your trial ends in ${days} day${days === 1 ? '' : 's'}`}
        </p>
        <p className="text-sm text-muted-foreground">
          Choose a plan on your platform account to keep the store trading once the trial is over.
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button asChild size="sm">
          <a href={platformUrl('/dashboard/plans')} target="_blank" rel="noreferrer">
            Manage plan
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss until tomorrow"
          onClick={() => dismiss(daysRemaining)}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </Card>
  );
}
