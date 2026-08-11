'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one carousel in this app.
 *
 * Built on CSS scroll-snap rather than a transform-track library, for three
 * reasons that matter here specifically:
 *
 * 1. **Every slide is real, server-rendered DOM.** The hero is the LCP element
 *    on all six templates. A JavaScript track has to hydrate before it looks
 *    right; this is correct in the first paint and stays correct if the bundle
 *    never arrives.
 * 2. **Native momentum.** Touch scrolling is the browser's, not a re-implement-
 *    ation of it, which is the difference nobody can name but everybody feels.
 * 3. **It is a scroll container.** Keyboard scrolling, screen-reader linear
 *    reading and `dir="rtl"` all work because they are the platform's, not
 *    something re-declared with ARIA.
 *
 * What is given up is a true infinite loop — stepping past the end wraps with a
 * scroll back to the start. For the two-to-five slides a storefront hero
 * actually carries, the two are indistinguishable.
 *
 * Every consumer imports from this file and nothing else, so if scroll-snap
 * ever proves unacceptable on a target browser, one file changes.
 */

interface CarouselContextValue {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  activeIndex: number;
  count: number;
  canScrollPrevious: boolean;
  canScrollNext: boolean;
  scrollTo: (index: number) => void;
  scrollBy: (delta: number) => void;
  /** Set once the visitor drives it themselves; stops any autoplay for good. */
  interacted: boolean;
  markInteracted: () => void;
  orientation: 'horizontal';
}

const CarouselContext = React.createContext<CarouselContextValue | null>(null);

export function useCarousel(): CarouselContextValue {
  const context = React.useContext(CarouselContext);
  if (!context) throw new Error('Carousel parts must be rendered inside <Carousel>.');
  return context;
}

export function Carousel({
  children,
  className,
  label,
  loop = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Names the region, e.g. "Featured promotions". */
  label: string;
  loop?: boolean;
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [count, setCount] = React.useState(0);
  const [edges, setEdges] = React.useState({ start: true, end: false });
  const [interacted, setInteracted] = React.useState(false);

  /** Measures which slide is nearest the leading edge of the viewport. */
  const measure = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const items = Array.from(viewport.querySelectorAll<HTMLElement>('[data-carousel-item]'));
    setCount(items.length);
    if (items.length === 0) return;

    const { scrollLeft, clientWidth, scrollWidth } = viewport;

    let nearest = 0;
    let smallest = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
      const distance = Math.abs(item.offsetLeft - viewport.offsetLeft - scrollLeft);
      if (distance < smallest) {
        smallest = distance;
        nearest = index;
      }
    });

    setActiveIndex(nearest);
    // A pixel of slack: sub-pixel layout means `scrollLeft` rarely lands exactly
    // on zero or on the maximum, and a disabled arrow that should be live is a
    // dead end.
    setEdges({
      start: scrollLeft <= 1,
      end: scrollLeft + clientWidth >= scrollWidth - 1,
    });
  }, []);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    measure();

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    // Slides resize with the viewport, and images arriving late change widths.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    for (const item of viewport.querySelectorAll('[data-carousel-item]')) observer.observe(item);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [measure, children]);

  const scrollTo = React.useCallback((index: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const items = viewport.querySelectorAll<HTMLElement>('[data-carousel-item]');
    const target = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!target) return;
    viewport.scrollTo({ left: target.offsetLeft - viewport.offsetLeft, behavior: 'smooth' });
  }, []);

  const scrollBy = React.useCallback(
    (delta: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const items = viewport.querySelectorAll<HTMLElement>('[data-carousel-item]');
      if (items.length === 0) return;

      let next = activeIndex + delta;
      if (next < 0) next = loop ? items.length - 1 : 0;
      if (next > items.length - 1) next = loop ? 0 : items.length - 1;
      scrollTo(next);
    },
    [activeIndex, loop, scrollTo],
  );

  const markInteracted = React.useCallback(() => setInteracted(true), []);

  const value = React.useMemo<CarouselContextValue>(
    () => ({
      viewportRef,
      activeIndex,
      count,
      canScrollPrevious: loop ? count > 1 : !edges.start,
      canScrollNext: loop ? count > 1 : !edges.end,
      scrollTo,
      scrollBy,
      interacted,
      markInteracted,
      orientation: 'horizontal',
    }),
    [activeIndex, count, edges.start, edges.end, loop, scrollTo, scrollBy, interacted, markInteracted],
  );

  return (
    <CarouselContext.Provider value={value}>
      <section aria-roledescription="carousel" aria-label={label} className={cn('relative', className)}>
        {children}
      </section>
    </CarouselContext.Provider>
  );
}

/**
 * The scroll container.
 *
 * `tabIndex={0}` because it scrolls: a keyboard user must be able to focus it
 * and use the arrow keys, and a focusable scroll region needs a role and a name
 * — both supplied here.
 */
export function CarouselViewport({
  children,
  className,
  gap = 'gap-4',
  snap = 'start',
}: {
  children: React.ReactNode;
  className?: string;
  gap?: string;
  snap?: 'start' | 'center';
}) {
  const { viewportRef, markInteracted, count } = useCarousel();

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      role="group"
      aria-label={`${count} items, scrollable`}
      onPointerDown={markInteracted}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') markInteracted();
      }}
      className={cn(
        'no-scrollbar flex snap-x overflow-x-auto scroll-smooth',
        // `mandatory` fights momentum on long product rails, so slides settle
        // where the finger left them rather than being yanked to a boundary.
        snap === 'center' ? 'snap-mandatory' : 'snap-proximity',
        gap,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CarouselItem({
  children,
  className,
  snap = 'start',
}: {
  children: React.ReactNode;
  className?: string;
  snap?: 'start' | 'center';
}) {
  return (
    <div
      data-carousel-item=""
      className={cn('shrink-0 grow-0', snap === 'center' ? 'snap-center' : 'snap-start', className)}
    >
      {children}
    </div>
  );
}

export function CarouselArrows({
  className,
  variant = 'floating',
  size = 'md',
}: {
  className?: string;
  /** `floating` overlays the rail; `inline` sits in a heading row. */
  variant?: 'floating' | 'inline';
  size?: 'sm' | 'md';
}) {
  const { scrollBy, canScrollPrevious, canScrollNext, markInteracted, count } = useCarousel();
  if (count <= 1) return null;

  const step = (delta: number) => {
    markInteracted();
    scrollBy(delta);
  };

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <ArrowButton direction="previous" disabled={!canScrollPrevious} onClick={() => step(-1)} size={size} />
        <ArrowButton direction="next" disabled={!canScrollNext} onClick={() => step(1)} size={size} />
      </div>
    );
  }

  return (
    <>
      <ArrowButton
        direction="previous"
        disabled={!canScrollPrevious}
        onClick={() => step(-1)}
        size={size}
        className={cn(
          'absolute left-0 top-1/2 z-20 hidden -translate-y-1/2 sm:grid lg:-left-4',
          className,
        )}
      />
      <ArrowButton
        direction="next"
        disabled={!canScrollNext}
        onClick={() => step(1)}
        size={size}
        className={cn(
          'absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 sm:grid lg:-right-4',
          className,
        )}
      />
    </>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
  size,
  className,
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
  size: 'sm' | 'md';
  className?: string;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'previous' ? 'Previous' : 'Next'}
      className={cn(
        'grid place-items-center rounded-full border border-border bg-surface text-foreground shadow-[var(--shadow-card)]',
        'transition-colors hover:border-primary hover:text-primary',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-8' : 'size-10',
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} aria-hidden />
    </button>
  );
}

export function CarouselDots({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const { count, activeIndex, scrollTo, markInteracted } = useCarousel();
  if (count <= 1) return null;

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      {Array.from({ length: count }, (_, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={index}
            type="button"
            onClick={() => {
              markInteracted();
              scrollTo(index);
            }}
            aria-label={`Go to slide ${index + 1} of ${count}`}
            aria-current={active ? 'true' : undefined}
            className={cn(
              // Hit area is 24px even though the dot is 8px — the visible mark
              // is decoration, the button is the control.
              'grid size-6 place-items-center',
              'after:block after:rounded-full after:transition-all',
              active ? 'after:w-5' : 'after:w-2 hover:after:w-3',
              'after:h-2',
              tone === 'light'
                ? active
                  ? 'after:bg-white'
                  : 'after:bg-white/50'
                : active
                  ? 'after:bg-primary'
                  : 'after:bg-border-strong',
            )}
          />
        );
      })}
    </div>
  );
}
