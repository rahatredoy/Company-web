'use client';

import { Heart } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import { useWishlist } from '@/lib/commerce/collections';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * The wishlist heart.
 *
 * A separate client island so `ProductCard` can stay a Server Component — the
 * card is rendered up to a hundred times on a listing page, and turning the
 * whole thing into client JavaScript to make one button work would ship the
 * markup twice.
 *
 * Until this existed the heart on every card was a `<button>` with no `onClick`:
 * a control that looked interactive, was announced as a button, and did nothing.
 */
export function WishlistButton({
  product,
  variant = 'floating',
  className,
}: {
  product: ProductSummary;
  variant?: 'floating' | 'inline';
  className?: string;
}) {
  const wishlist = useWishlist();
  const hydrated = useHydrated();

  // Before hydration the answer is genuinely unknown, so the button renders in
  // its neutral state rather than guessing and flipping.
  const saved = hydrated && wishlist.has(product.id);

  const onClick = () => {
    const added = wishlist.toggle(product);
    toast[added ? 'success' : 'message'](
      added ? 'Saved to your wishlist' : 'Removed from your wishlist',
      added ? { action: { label: 'View', onClick: () => (window.location.href = '/wishlist') } } : undefined,
    );
  };

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        className={cn(
          'inline-flex h-11 items-center gap-2 rounded-(--radius-button) border border-border-strong px-4 text-sm font-medium transition-colors',
          saved ? 'border-primary text-primary' : 'hover:bg-surface-alt',
          className,
        )}
      >
        <Heart className={cn('size-4', saved && 'fill-current')} aria-hidden />
        {saved ? 'Saved' : 'Add to wishlist'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
      className={cn(
        'absolute right-2 top-2 z-20 grid size-9 place-items-center rounded-full bg-surface/90 shadow-[var(--shadow-card)] transition-colors',
        saved ? 'text-primary' : 'text-foreground hover:text-primary',
        className,
      )}
    >
      <Heart className={cn('size-4', saved && 'fill-current')} aria-hidden />
    </button>
  );
}
