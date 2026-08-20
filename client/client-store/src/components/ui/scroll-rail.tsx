'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A one-line list that scrolls sideways instead of wrapping.
 *
 * For rows of short, variable-width things — subcategory chips, filter pills —
 * where wrapping is the wrong answer at both ends of the range. On a phone a
 * dozen chips became five stacked rows that pushed the products themselves off
 * the screen; on a monitor the same row wrapped after the tenth and left a
 * ragged second line under it. One line that scrolls is the same shape at every
 * width, and how many are visible is simply how many fit.
 *
 * Deliberately not the carousel in `components/carousel/`. That is built for
 * slides — it steps item by item, and it announces itself to a screen reader as
 * `aria-roledescription="carousel"`. This is a list of links that happens to
 * overflow, so it stays a `<ul>` and scrolls by the eyeful.
 *
 * The arrows are an enhancement over a container that already works. Every chip
 * is real DOM inside a native scroller, so touch, trackpad, keyboard and screen
 * readers reach all of them whether or not this component's JavaScript ever
 * arrives — the buttons only add a pointer affordance for a mouse, which is the
 * one input with no natural way to scroll a horizontal strip.
 */
export function ScrollRail({
  children,
  label,
  size = 'md',
  className,
}: {
  children: React.ReactNode;
  /** Names the list, e.g. "Narrow Electronics". */
  label: string;
  /** `sm` for a rail inside a card, where a 32px button would dominate. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const scrollerRef = React.useRef<HTMLUListElement | null>(null);

  /*
   * Both true until measured, so the server render and the first client render
   * agree on "no arrows" and hydration has nothing to reconcile. A row that
   * does not overflow never leaves this state.
   */
  const [edges, setEdges] = React.useState({ start: true, end: true });

  const measure = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const { scrollLeft, clientWidth, scrollWidth } = scroller;
    // A pixel of slack: sub-pixel layout means `scrollLeft` rarely lands exactly
    // on zero or on the maximum, and an arrow left pointing at nothing is worse
    // than no arrow at all.
    setEdges({
      start: scrollLeft <= 1,
      end: scrollLeft + clientWidth >= scrollWidth - 1,
    });
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    measure();

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    // The row reflows with the window, and a late web font changes every chip's
    // width — both decide whether there is anything to scroll to.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);

    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [measure, children]);

  const step = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Four fifths of a screenful rather than all of it: the chip that was at the
    // edge stays on screen, so the reader keeps their place in the row.
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className={cn('relative', className)}>
      <ul
        ref={scrollerRef}
        aria-label={label}
        className={cn(
          'no-scrollbar flex snap-x snap-proximity overflow-x-auto scroll-smooth',
          // `py`/`-my` cancel out: `overflow-x` forces `overflow-y` to `auto`,
          // so without the padding a focus ring on a chip is clipped top and
          // bottom by the scroller it sits in.
          'py-1 -my-1',
          size === 'sm' ? 'gap-1.5' : 'gap-2',
          // Applied from here rather than asked of every caller: a chip that is
          // allowed to shrink wraps its own label instead of overflowing, which
          // is the wrapping this component exists to stop.
          '[&>li]:shrink-0 [&>li]:snap-start',
        )}
      >
        {children}
      </ul>

      {/*
        The fade is the honest signal — it says "this row continues" at every
        width and on every input, including touch, where the buttons are
        redundant. It is painted in the page's own background so it reads as the
        chips passing under the edge rather than as a grey panel.
      */}
      <Fade side="left" hidden={edges.start} />
      <Fade side="right" hidden={edges.end} />

      <Arrow direction="left" hidden={edges.start} size={size} onClick={() => step(-1)} />
      <Arrow direction="right" hidden={edges.end} size={size} onClick={() => step(1)} />
    </div>
  );
}

function Fade({ side, hidden }: { side: 'left' | 'right'; hidden: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-y-0 z-10 w-10 transition-opacity duration-200',
        side === 'left'
          ? 'left-0 bg-linear-to-r from-background to-transparent'
          : 'right-0 bg-linear-to-l from-background to-transparent',
        hidden && 'opacity-0',
      )}
    />
  );
}

function Arrow({
  direction,
  hidden,
  size,
  onClick,
}: {
  direction: 'left' | 'right';
  hidden: boolean;
  size: 'sm' | 'md';
  onClick: () => void;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      /*
       * Hidden from the accessibility tree and from the tab order, not merely
       * from view. A keyboard user reaches every chip by tabbing through the
       * links themselves, and a screen reader gets the list — neither needs a
       * control whose only job is to move a scrollbar a mouse cannot drag.
       */
      aria-hidden
      tabIndex={-1}
      className={cn(
        'absolute top-1/2 z-20 grid -translate-y-1/2 place-items-center rounded-full',
        'border border-border bg-surface text-foreground shadow-[var(--shadow-card)]',
        'transition-[opacity,color,border-color] duration-200 hover:border-primary hover:text-primary',
        direction === 'left' ? 'left-0' : 'right-0',
        size === 'sm' ? 'size-6' : 'size-8',
        hidden && 'pointer-events-none opacity-0',
      )}
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
    </button>
  );
}
