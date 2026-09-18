'use client';

import type { HeroSlide } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import {
  Carousel,
  CarouselArrows,
  CarouselItem,
  CarouselViewport,
} from '@/components/carousel/carousel';
import { useAutoAdvance } from '@/components/carousel/use-auto-advance';
import { useT } from '@/lib/i18n';
import { HeroSlideView } from './hero-slide';

/**
 * The homepage hero.
 *
 * A single slide renders as a plain panel — no carousel wrapper and no arrows.
 * Controls for stepping through a set of one are noise, and the extra scroll
 * container would be one more thing for a screen reader to announce.
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
  const t = useT();

  if (slides.length === 0) return null;

  if (slides.length === 1) {
    return <HeroSlideView slide={slides[0]!} variant={variant} priority={priority} />;
  }

  return (
    <Carousel label={t('Featured promotions')}>
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

      {/*
        Always drawn, and never disabled. The hero loops, so neither arrow is
        ever a dead end — there is no first slide to be stuck at and no last one
        to run out of, and an arrow that greys out at an edge would be saying
        otherwise. Revealing them on hover was the other half of the same
        problem: a control the visitor has to discover by accident is one most
        of them never find, and a touch screen has no hover to discover it with.
      */}
      <CarouselArrows />
    </div>
  );
}
