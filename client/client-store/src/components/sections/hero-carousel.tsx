'use client';

import type { HeroSlide } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import {
  Carousel,
  CarouselArrows,
  CarouselDots,
  CarouselItem,
  CarouselViewport,
} from '@/components/carousel/carousel';
import { useAutoAdvance } from '@/components/carousel/use-auto-advance';
import { cn } from '@/lib/utils';
import { HeroSlideView } from './hero-slide';

/**
 * The homepage hero.
 *
 * A single slide renders as a plain panel — no carousel wrapper, no arrows, no
 * dots. Controls for stepping through a set of one are noise, and the extra
 * scroll container would be one more thing for a screen reader to announce.
 *
 * With several slides every one of them is in the served HTML. Nothing here
 * defers a slide until hydration, so the first paint is the complete hero and
 * the LCP image is a real `<img>` the browser can start before any JavaScript.
 */
export function HeroCarousel({
  slides,
  variant,
  priority,
  autoplayMs = 6500,
}: {
  slides: HeroSlide[];
  variant: TemplatePreset['heroVariant'];
  priority: boolean;
  autoplayMs?: number;
}) {
  if (slides.length === 0) return null;

  if (slides.length === 1) {
    return <HeroSlideView slide={slides[0]!} variant={variant} priority={priority} />;
  }

  return (
    <Carousel label="Featured promotions" className="group/hero">
      <HeroTrack slides={slides} variant={variant} priority={priority} autoplayMs={autoplayMs} />
    </Carousel>
  );
}

/**
 * Split out because `useAutoAdvance` reads the carousel context, which only
 * exists inside `<Carousel>`.
 */
function HeroTrack({
  slides,
  variant,
  priority,
  autoplayMs,
}: {
  slides: HeroSlide[];
  variant: TemplatePreset['heroVariant'];
  priority: boolean;
  autoplayMs: number;
}) {
  const { pauseProps } = useAutoAdvance({ intervalMs: autoplayMs });
  const overlaid = variant === 'fullbleed' || variant === 'tech';

  return (
    <div className="relative" {...pauseProps}>
      <CarouselViewport gap="gap-0" snap="center">
        {slides.map((slide, index) => (
          <CarouselItem key={slide.id} snap="center" className="w-full">
            <HeroSlideView
              slide={slide}
              variant={variant}
              priority={priority && index === 0}
              headingLevel={index === 0 ? 1 : 2}
            />
          </CarouselItem>
        ))}
      </CarouselViewport>

      {/* Arrows appear on hover on pointer devices, and are always present for keyboards. */}
      <CarouselArrows className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/hero:opacity-100 focus:opacity-100" />

      <CarouselDots
        tone={overlaid ? 'light' : 'dark'}
        className={cn('absolute inset-x-0 z-20', overlaid ? 'bottom-6' : 'bottom-4 lg:bottom-6')}
      />
    </div>
  );
}
