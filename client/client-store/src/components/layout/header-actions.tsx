'use client';

import Link from 'next/link';
import { Heart, ShoppingCart, User } from 'lucide-react';
import { useCart } from '@/lib/commerce/cart';
import { useWishlist } from '@/lib/commerce/collections';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * Account, wishlist and cart — the three controls every template's header has.
 *
 * Reads the stores directly rather than taking counts as props. It used to take
 * `cartCount`/`wishlistCount`, which no template ever passed — six headers each
 * having to remember to thread two numbers through is six chances for one badge
 * to be permanently stale, and it was.
 *
 * Counts render only after hydration. They live in `localStorage`, which the
 * server cannot read, so rendering them on the first pass would guarantee a
 * mismatch — and showing a fabricated zero would be worse than showing nothing.
 */
export function HeaderActions({ className }: { className?: string }) {
  const { cart } = useCart();
  const wishlist = useWishlist();
  const hydrated = useHydrated();

  const cartCount = hydrated ? cart.itemCount : 0;
  const wishlistCount = hydrated ? wishlist.count : 0;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <Link
        href="/account"
        aria-label="Your account"
        className="grid size-11 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt"
      >
        <User className="size-5" aria-hidden />
      </Link>

      <Link
        href="/wishlist"
        aria-label={wishlistCount ? `Wishlist, ${wishlistCount} items` : 'Wishlist'}
        className="relative grid size-11 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt"
      >
        <Heart className="size-5" aria-hidden />
        {wishlistCount ? <Badge count={wishlistCount} /> : null}
      </Link>

      {/*
        A plain link to the cart page — the same as account and wishlist beside
        it. It briefly opened a slide-over instead; a panel that arrives from
        the edge behaves unlike every other destination in the header, and the
        cart page already shows more than the panel could.
      */}
      <Link
        href="/cart"
        aria-label={cartCount ? `Cart, ${cartCount} items` : 'Cart'}
        className="relative grid size-11 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt"
      >
        <ShoppingCart className="size-5" aria-hidden />
        {cartCount ? <Badge count={cartCount} /> : null}
      </Link>
    </div>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="absolute right-1.5 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
