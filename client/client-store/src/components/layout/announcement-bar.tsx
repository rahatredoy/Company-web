'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { StoreConfig } from '@/types';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { usePrefersReducedMotion } from '@/lib/hooks/use-prefers-reduced-motion';

const ROTATE_MS = 6000;

/**
 * The strip above the header. Modern Shop does not render it at all — there the
 * header itself is the top of the page.
 *
 * A store runs several notices at once — a shipping threshold, a live campaign,
 * a holiday cutoff — so this rotates rather than forcing the owner to pick one.
 * With a single message it is a plain static bar and the arrows never appear:
 * controls that step through a list of one are noise.
 *
 * Rotation stops permanently the moment someone uses an arrow. Continuing to
 * move the thing a visitor is reading, after they have said which one they
 * want, is the behaviour that makes carousels hated.
 */
export function AnnouncementBar({
  announcement,
  className,
  trailing,
}: {
  announcement: StoreConfig['announcement'];
  className?: string;
  /** Slot at the far right — the language and currency selects in two of the templates. */
  trailing?: React.ReactNode;
}) {
  const t = useT();
  const messages = announcement.enabled
    ? announcement.messages.filter((message) => message.text.trim().length > 0)
    : [];

  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [interacted, setInteracted] = React.useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const count = messages.length;
  const rotates = count > 1 && !interacted && !reducedMotion && !paused;

  React.useEffect(() => {
    if (!rotates) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [rotates, count]);

  if (count === 0) return null;

  const current = messages[Math.min(index, count - 1)]!;

  function step(delta: number) {
    setInteracted(true);
    setIndex((value) => (value + delta + count) % count);
  }

  return (
    <div className={cn('bg-secondary text-secondary-foreground', className)}>
      <div
        className="container-store flex min-h-9 items-center gap-2 py-1.5 text-xs sm:text-[12px]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {count > 1 ? (
          <TickerArrow direction="previous" onClick={() => step(-1)} />
        ) : (
          <span className="hidden w-7 sm:block" aria-hidden />
        )}

        {/*
          `polite` rather than `assertive`: a promotional line rotating in the
          background must never interrupt what a screen reader is already saying.
        */}
        <p
          aria-live="polite"
          aria-atomic="true"
          className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center"
        >
          <span className="truncate sm:whitespace-normal">{current.text}</span>
          {/* Only internal destinations — an announcement is not a place to host an outbound redirect. */}
          {current.linkUrl && current.linkUrl.startsWith('/') ? (
            <Link
              href={current.linkUrl}
              className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline"
            >
              {current.linkLabel ?? t('Shop now')}
            </Link>
          ) : null}
        </p>

        {count > 1 ? (
          <TickerArrow direction="next" onClick={() => step(1)} />
        ) : (
          <span className="hidden w-7 sm:block" aria-hidden />
        )}

        {trailing ? <div className="hidden shrink-0 items-center gap-1 sm:flex">{trailing}</div> : null}
      </div>
    </div>
  );
}

function TickerArrow({
  direction,
  onClick,
}: {
  direction: 'previous' | 'next';
  onClick: () => void;
}) {
  const t = useT();
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'previous' ? t('Previous announcement') : t('Next announcement')}
      className="grid size-7 shrink-0 place-items-center rounded-(--radius-button) opacity-80 transition-opacity hover:opacity-100"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
