'use client';

import { Zap } from 'lucide-react';
import type { ProductSummary } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { cn } from '@/lib/utils';
import { Countdown } from './countdown';
import { ProductCarousel } from './product-carousel';

/**
 * Flash deals: a countdown and a rail of discounted products on one dark band.
 *
 * The clock and the products are the same components used elsewhere; only the
 * band around them is new. That matters because a flash-sale block is exactly
 * where a bespoke product card tends to get written and then quietly stop
 * showing the sale price correctly.
 */
export function FlashSaleRail({
  title,
  subtitle,
  deadline,
  products,
  perView,
  cardVariant,
  locale,
  className,
}: {
  /** The campaign's own name. Null renders the band without a heading. */
  title: string | null;
  subtitle?: string | null;
  deadline: number;
  products: ProductSummary[];
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  locale: string;
  className?: string;
}) {
  if (products.length === 0) return null;

  return (
    <div className={cn('overflow-hidden rounded-(--radius-card) bg-secondary', className)}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-secondary-foreground sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-white/12">
            <Zap className="size-5" aria-hidden />
          </span>
          <div>
            {title ? <h2 className="text-lg font-semibold leading-tight">{title}</h2> : null}
            {subtitle ? <p className="text-xs opacity-75">{subtitle}</p> : null}
          </div>
        </div>

        <Countdown deadline={deadline} size="sm" tone="surface" expiredLabel="Deals have ended" />
      </div>

      <div className="bg-surface p-4 sm:p-5">
        <ProductCarousel
          products={products}
          perView={perView}
          cardVariant={cardVariant}
          locale={locale}
          label={title ?? 'Flash sale'}
        />
      </div>
    </div>
  );
}
