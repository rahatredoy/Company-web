import type { PromoBanner, ProductSummary } from '@/types';
import { cn } from '@/lib/utils';
import { DealOfTheDay } from './deal-of-the-day';
import { PromoBannerGrid } from './promo-banner-grid';
import { PromoMosaicBanners } from './promo-mosaic-banners';

/**
 * The three-zone promotional block: a deal card beside a small grid of
 * campaign panels, with a wide one beneath them.
 *
 * It is the densest merchandising layout of the set — one live deal, two
 * category shortcuts and a campaign, in a single screen's height. Degrades
 * sensibly: with no deal product the banners take the full width, and with
 * fewer than three banners the remaining slots simply close up rather than
 * leaving holes in the grid.
 *
 * With *more* than three the extra ones are not dropped: the three panels are
 * a window onto the list, and it moves every ten seconds.
 */
export function PromoMosaic({
  dealProduct,
  deadline,
  dealTitle,
  banners,
  locale,
  className,
}: {
  dealProduct: ProductSummary | null;
  deadline: number | null;
  dealTitle: string | null;
  banners: PromoBanner[];
  locale: string;
  className?: string;
}) {
  if (!dealProduct && banners.length === 0) return null;

  // Without the deal card the block is just a promo row, and that is a layout
  // this file would otherwise keep a second copy of.
  if (!dealProduct) {
    return <PromoBannerGrid banners={banners} columns={3} ratio="wide" className={className} />;
  }

  return (
    <div className={cn('grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]', className)}>
      <DealOfTheDay
        product={dealProduct}
        deadline={deadline}
        title={dealTitle}
        locale={locale}
        layout="split"
      />

      {banners.length > 0 ? <PromoMosaicBanners banners={banners} /> : null}
    </div>
  );
}
