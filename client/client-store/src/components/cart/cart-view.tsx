'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/lib/commerce/cart';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { pluralise } from '@/lib/utils';
import { CartLineItem } from './cart-line-item';
import { CartSummary } from './cart-summary';

/**
 * The cart page contents.
 *
 * Renders a skeleton until hydration rather than an empty state. The basket is
 * in `localStorage`, which the server cannot read — so before hydration the
 * page genuinely does not know whether it is empty, and flashing "Your cart is
 * empty" at someone who has ten items in it is the worst possible guess.
 */
export function CartView({ locale }: { locale: string }) {
  const { cart, clear } = useCart();
  const hydrated = useHydrated();

  if (!hydrated) {
    return (
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
        <div className="space-y-4">
          <span className="sr-only">Loading your cart…</span>
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex gap-4">
              <Skeleton className="size-28 rounded-(--radius-button)" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-9 w-32" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-72 rounded-(--radius-card)" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Your cart is empty"
        description="Once you add something it will show up here, and stay here if you come back later."
        action={
          <>
            <Button asChild size="lg">
              <Link href="/shop">Continue shopping</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/wishlist">View your wishlist</Link>
            </Button>
          </>
        }
        className="mt-6 rounded-(--radius-card) border border-dashed border-border"
      />
    );
  }

  return (
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <p className="text-sm text-muted">
            {cart.itemCount} {pluralise(cart.itemCount, 'item')} in your cart
          </p>

          <button
            type="button"
            onClick={clear}
            className="text-sm text-muted underline-offset-4 transition-colors hover:text-error hover:underline"
          >
            Clear cart
          </button>
        </div>

        <ul className="divide-y divide-border">
          {cart.lines.map((line) => (
            <CartLineItem
              key={line.id}
              line={line}
              currency={cart.totals.currency}
              locale={locale}
            />
          ))}
        </ul>

        <div className="mt-6">
          <Button asChild variant="ghost">
            <Link href="/shop">← Continue shopping</Link>
          </Button>
        </div>
      </div>

      <CartSummary cart={cart} locale={locale} className="lg:sticky lg:top-24" />
    </div>
  );
}
