'use client';

import type { PromoBanner } from '@/types';
import { PromoBannerCard } from './promo-banner-grid';
import { useBannerRotation } from './banner-rotation';

/**
 * The mosaic's campaign column: two panels side by side with a wide one under
 * them, and — where the store runs more than three campaigns — a fresh set of
 * three every ten seconds.
 *
 * Its own component so `PromoMosaic` stays a server component: the deal card
 * beside it is the block's real content and has no reason to ship to the
 * browser just because the panels next to it move.
 */
export function PromoMosaicBanners({ banners }: { banners: PromoBanner[] }) {
  const { visible, page, pauseProps, frameClassName } = useBannerRotation(banners, 3);
  const [first, second, third] = visible;

  return (
    <div {...pauseProps}>
      <div className="grid gap-4">
        {first || second ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Keyed by page as well as id, so a swapped panel mounts and fades
                in rather than quietly changing its own contents. */}
            {first ? (
              <div key={`${page}-${first.id}`} className={frameClassName}>
                <PromoBannerCard banner={first} ratio="panel" />
              </div>
            ) : null}
            {second ? (
              <div key={`${page}-${second.id}`} className={frameClassName}>
                <PromoBannerCard banner={second} ratio="panel" />
              </div>
            ) : null}
          </div>
        ) : null}

        {third ? (
          <div key={`${page}-${third.id}`} className={frameClassName}>
            <PromoBannerCard banner={third} ratio="panel" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
