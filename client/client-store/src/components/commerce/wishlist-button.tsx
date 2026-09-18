'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import { useWishlist } from '@/lib/commerce/collections';
import { WishlistIcon } from '@/lib/commerce/wishlist-icon';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The wishlist button.
 *
 * A separate client island so `ProductCard` can stay a Server Component — the
 * card is rendered up to a hundred times on a listing page, and turning the
 * whole thing into client JavaScript to make one button work would ship the
 * markup twice.
 *
 * Until this existed the control on every card was a `<button>` with no
 * `onClick`: it looked interactive, was announced as a button, and did nothing.
 *
 * The glyph comes from `lib/commerce/wishlist-icon` rather than from
 * `lucide-react` here, because six other surfaces show the same thing and they
 * have to agree — see that file for why it is a bookmark and not a heart.
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
  const t = useT();
  const router = useRouter();
  const wishlist = useWishlist();
  const hydrated = useHydrated();

  // Before hydration the answer is genuinely unknown, so the button renders in
  // its neutral state rather than guessing and flipping.
  const saved = hydrated && wishlist.has(product.id);

  const onClick = () => {
    const added = wishlist.toggle(product);
    toast[added ? 'success' : 'message'](
      added ? t('Saved to your wishlist') : t('Removed from your wishlist'),
      added ? { action: { label: t('View'), onClick: () => router.push('/wishlist') } } : undefined,
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
        <WishlistIcon className={cn('size-4', saved && 'fill-current')} aria-hidden />
        {saved ? t('Saved') : t('Add to wishlist')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={
        saved
          ? t('Remove {name} from wishlist', { name: product.name })
          : t('Add {name} to wishlist', { name: product.name })
      }
      className={cn(
        'absolute right-2 top-2 z-20 grid size-9 place-items-center rounded-full bg-surface/90 shadow-[var(--shadow-card)] transition-colors',
        saved ? 'text-primary' : 'text-foreground hover:text-primary',
        className,
      )}
    >
      <WishlistIcon className={cn('size-4', saved && 'fill-current')} aria-hidden />
    </button>
  );
}
