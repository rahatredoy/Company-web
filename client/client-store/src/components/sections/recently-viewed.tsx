'use client';

import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { useRecentlyViewed } from '@/lib/commerce/collections';
import { ProductCarousel } from './product-carousel';
import { SectionHeading } from './section-shell';

/**
 * The products this visitor has looked at.
 *
 * The only homepage block the server never sees the contents of. The list lives
 * in the visitor's own browser — written by the product page, read here — so it
 * needs no account, sets no cookie, and reaches no API: nothing about what
 * somebody browsed leaves their machine.
 *
 * That also makes it the one section whose emptiness is normal rather than a
 * misconfiguration. A first-time visitor has no history, `serverSnapshot`
 * returns an empty list during SSR, and both cases render nothing — which is
 * why this must never draw a heading before it knows it has something to put
 * under it.
 *
 * `excludeId` lets the product page reuse the rail without listing the product
 * already on screen.
 */
export function RecentlyViewed({
  title,
  perView,
  cardVariant,
  locale,
  excludeId,
  className,
}: {
  title: string;
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  locale: string;
  excludeId?: string;
  className?: string;
}) {
  const { items } = useRecentlyViewed();
  const products = excludeId ? items.filter((product) => product.id !== excludeId) : items;

  if (products.length === 0) return null;

  return (
    <div className={className}>
      <SectionHeading title={title} size="sm" />
      <ProductCarousel
        products={products}
        perView={perView}
        cardVariant={cardVariant}
        locale={locale}
        label={title}
      />
    </div>
  );
}
