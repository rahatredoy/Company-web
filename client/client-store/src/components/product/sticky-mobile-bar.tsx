'use client';

import * as React from 'react';
import { ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * The mobile price + Add to Cart bar.
 *
 * Appears once the real button has scrolled out of view, so there are never two
 * live Add to Cart controls competing on screen at the same moment.
 *
 * Sits above the bottom navigation and honours the safe-area inset — the whole
 * point of this bar is that the buying action is always one thumb-reach away,
 * and putting it under the home indicator defeats that entirely.
 */
export function StickyMobileBar({
  price,
  currency,
  locale,
  inStock,
  onAddToCart,
  watchRef,
  hasBottomNav = false,
}: {
  price: string;
  currency: string;
  locale: string;
  inStock: boolean;
  onAddToCart: () => void;
  /** The in-page Add to Cart button; the bar shows only once it is off screen. */
  watchRef: React.RefObject<HTMLElement | null>;
  hasBottomNav?: boolean;
}) {
  const t = useT();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const target = watchRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry!.isIntersecting),
      { rootMargin: '0px 0px -20% 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [watchRef]);

  return (
    <div
      className={cn(
        'fixed inset-x-0 z-30 border-t border-border bg-surface px-4 py-3 lg:hidden',
        'transition-transform duration-200',
        visible ? 'translate-y-0' : 'translate-y-full',
        hasBottomNav
          ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
          : 'bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
      )}
      aria-hidden={!visible}
    >
      <div className="flex items-center gap-3">
        <p className="text-lg font-semibold tabular-nums">{formatMoney(price, currency, locale)}</p>

        <button
          type="button"
          onClick={onAddToCart}
          disabled={!inStock}
          tabIndex={visible ? 0 : -1}
          className={cn(
            'ml-auto inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-(--radius-button) px-5 text-sm font-medium',
            'bg-primary text-primary-foreground transition-colors hover:bg-primary-hover',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <ShoppingCart className="size-4" aria-hidden />
          {inStock ? t('Add to cart') : t('Out of stock')}
        </button>
      </div>
    </div>
  );
}
