'use client';

import type { ProductSummary } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import {
  Carousel,
  CarouselArrows,
  CarouselItem,
  CarouselViewport,
} from '@/components/carousel/carousel';
import { cn } from '@/lib/utils';

/**
 * A horizontally scrolling rail of product cards.
 *
 * How many fit across comes from the template's `carouselPerView`, so "six on a
 * wide screen, two on a phone" is a number in a preset rather than a grid class
 * every template re-derives and one of them gets wrong.
 *
 * `product-rail` on the root is not styling either — it is what `globals.css`
 * narrows the two-across phone override to, so a rail of products answers to it
 * and `GenericCarousel`'s lookbook tiles and logo strips do not.
 *
 * Because it is a scroll container, the cards a visitor cannot currently see are
 * still in the document — reachable by keyboard, readable by a screen reader,
 * and indexable. A transform track with `overflow: hidden` hides them from all
 * three.
 */

/*
 * Widths as literal classes, one map per breakpoint.
 *
 * They cannot be built from a template string. Tailwind scans source text for
 * class names it can see, so `lg:basis-1/${count}` is compiled out of the
 * stylesheet and the rail silently collapses. The `calc` subtracts the gaps so
 * six items and five 1rem gaps land at exactly 100% rather than overflowing.
 */
const BASIS_BASE: Record<number, string> = {
  1: 'basis-full',
  2: 'basis-[calc((100%-1rem)/2)]',
  3: 'basis-[calc((100%-2rem)/3)]',
  4: 'basis-[calc((100%-3rem)/4)]',
  5: 'basis-[calc((100%-4rem)/5)]',
  6: 'basis-[calc((100%-5rem)/6)]',
};

const BASIS_SM: Record<number, string> = {
  1: 'sm:basis-full',
  2: 'sm:basis-[calc((100%-1rem)/2)]',
  3: 'sm:basis-[calc((100%-2rem)/3)]',
  4: 'sm:basis-[calc((100%-3rem)/4)]',
  5: 'sm:basis-[calc((100%-4rem)/5)]',
  6: 'sm:basis-[calc((100%-5rem)/6)]',
};

const BASIS_LG: Record<number, string> = {
  1: 'lg:basis-full',
  2: 'lg:basis-[calc((100%-1rem)/2)]',
  3: 'lg:basis-[calc((100%-2rem)/3)]',
  4: 'lg:basis-[calc((100%-3rem)/4)]',
  5: 'lg:basis-[calc((100%-4rem)/5)]',
  6: 'lg:basis-[calc((100%-5rem)/6)]',
};

const BASIS_XL: Record<number, string> = {
  1: 'xl:basis-full',
  2: 'xl:basis-[calc((100%-1rem)/2)]',
  3: 'xl:basis-[calc((100%-2rem)/3)]',
  4: 'xl:basis-[calc((100%-3rem)/4)]',
  5: 'xl:basis-[calc((100%-4rem)/5)]',
  6: 'xl:basis-[calc((100%-5rem)/6)]',
};

const clamp = (value: number) => Math.min(6, Math.max(1, Math.round(value)));

export function railItemClass(perView: TemplatePreset['carouselPerView']): string {
  return cn(
    BASIS_BASE[clamp(perView.base)],
    BASIS_SM[clamp(perView.sm)],
    BASIS_LG[clamp(perView.lg)],
    BASIS_XL[clamp(perView.xl)],
  );
}

export function ProductCarousel({
  products,
  perView,
  cardVariant,
  locale,
  label,
  showArrows = true,
  className,
}: {
  products: ProductSummary[];
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  locale: string;
  label: string;
  showArrows?: boolean;
  className?: string;
}) {
  if (products.length === 0) return null;

  const itemClass = railItemClass(perView);

  return (
    <Carousel label={label} loop={false} className={cn('product-rail group/rail', className)}>
      <div className="relative">
        <CarouselViewport gap="gap-4" className="pb-1">
          {products.map((product) => (
            <CarouselItem key={product.id} className={itemClass}>
              <ProductCard
                product={product}
                variant={cardVariant}
                locale={locale}
                className="h-full"
              />
            </CarouselItem>
          ))}
        </CarouselViewport>

        {showArrows ? <CarouselArrows /> : null}
      </div>
    </Carousel>
  );
}

/** The same rail for anything that is not a product card — lookbook tiles, logos. */
export function GenericCarousel({
  children,
  perView,
  label,
  showArrows = true,
  className,
  itemClassName,
}: {
  children: React.ReactNode[];
  perView: TemplatePreset['carouselPerView'];
  label: string;
  showArrows?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  if (children.length === 0) return null;

  const itemClass = railItemClass(perView);

  return (
    <Carousel label={label} loop={false} className={cn('group/rail', className)}>
      <div className="relative">
        <CarouselViewport gap="gap-4">
          {children.map((child, index) => (
            <CarouselItem key={index} className={cn(itemClass, itemClassName)}>
              {child}
            </CarouselItem>
          ))}
        </CarouselViewport>

        {showArrows ? <CarouselArrows /> : null}
      </div>
    </Carousel>
  );
}
