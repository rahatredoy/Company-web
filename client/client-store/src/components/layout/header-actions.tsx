'use client';

import * as React from 'react';
import Link from 'next/link';
import { Heart, ShoppingCart, User } from 'lucide-react';
import { useCart } from '@/lib/commerce/cart';
import { useWishlist } from '@/lib/commerce/collections';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { CartDrawer, opensElsewhere } from '@/components/cart/cart-drawer';
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
export function HeaderActions({ className, locale = 'en' }: { className?: string; locale?: string }) {
  const { cart } = useCart();
  const wishlist = useWishlist();
  const hydrated = useHydrated();
  const [cartOpen, setCartOpen] = React.useState(false);

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
        Still a link, and that is the point. An earlier slide-over replaced the
        link outright, which made the cart the one header control that could not
        be opened in a new tab and did nothing without JavaScript. Here the
        `href` remains the real behaviour — modified and middle clicks fall
        through to `/cart`, and so does a browser with scripting off — while a
        plain left-click opens the panel instead of leaving the page.
      */}
      <Link
        href="/cart"
        aria-label={cartCount ? `Cart, ${cartCount} items` : 'Cart'}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          setCartOpen(true);
        }}
        className="relative grid size-11 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt"
      >
        <ShoppingCart className="size-5" aria-hidden />
        {cartCount ? <Badge count={cartCount} /> : null}
      </Link>

      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} locale={locale} />
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
