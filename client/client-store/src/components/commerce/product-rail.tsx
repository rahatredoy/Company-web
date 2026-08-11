import type { ProductSummary } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from './product-card';
import { SectionHeading } from '@/components/sections/section-shell';
import { ProductCarousel } from '@/components/sections/product-carousel';

/**
 * A titled rail of products, for use outside the homepage.
 *
 * Related products, recently viewed, "more from this brand" — the same
 * presentation the homepage sections use, so a product page's carousel behaves
 * identically to the homepage's rather than being a second implementation that
 * drifts.
 */
export function ProductRail({
  title,
  products,
  perView,
  cardVariant,
  locale,
  action,
  className,
}: {
  title: string;
  products: ProductSummary[];
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  locale: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  if (products.length === 0) return null;

  return (
    <section className={className} aria-label={title}>
      <SectionHeading title={title} size="sm" action={action} />
      <ProductCarousel
        products={products}
        perView={perView}
        cardVariant={cardVariant}
        locale={locale}
        label={title}
      />
    </section>
  );
}
