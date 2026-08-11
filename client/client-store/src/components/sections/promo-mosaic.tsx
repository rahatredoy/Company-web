import type { PromoBanner, ProductSummary } from '@/types';
import { cn } from '@/lib/utils';
import { DealOfTheDay } from './deal-of-the-day';
import { PromoBannerCard } from './promo-banner-grid';

/**
 * The three-zone promotional block: a deal card beside a small grid of
 * campaign panels, with a wide one beneath them.
 *
 * It is the densest merchandising layout of the set — one live deal, two
 * category shortcuts and a campaign, in a single screen's height. Degrades
 * sensibly: with no deal product the banners take the full width, and with
 * fewer than three banners the remaining slots simply close up rather than
 * leaving holes in the grid.
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
  dealTitle?: string | null;
  banners: PromoBanner[];
  locale: string;
  className?: string;
}) {
  if (!dealProduct && banners.length === 0) return null;

  if (!dealProduct) {
    return (
      <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
        {banners.slice(0, 3).map((banner) => (
          <li key={banner.id}>
            <PromoBannerCard banner={banner} ratio="wide" />
          </li>
        ))}
      </ul>
    );
  }

  const [first, second, third] = banners;

  return (
    <div className={cn('grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]', className)}>
      <DealOfTheDay
        product={dealProduct}
        deadline={deadline}
        title={dealTitle}
        locale={locale}
        layout="split"
      />

      {banners.length > 0 ? (
        <div className="grid gap-4">
          {first || second ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {first ? <PromoBannerCard banner={first} ratio="panel" /> : null}
              {second ? <PromoBannerCard banner={second} ratio="panel" /> : null}
            </div>
          ) : null}

          {third ? <PromoBannerCard banner={third} ratio="panel" /> : null}
        </div>
      ) : null}
    </div>
  );
}
