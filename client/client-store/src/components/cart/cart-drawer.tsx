'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/lib/commerce/cart';
import { formatMoney } from '@/lib/utils';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CartLineItem } from './cart-line-item';

/**
 * The cart, as a panel from the edge.
 *
 * This existed once, was removed, and is back on different terms. The objection
 * recorded in `header-actions.tsx` was that a panel arriving from the edge
 * "behaves unlike every other destination in the header" — which was true of
 * the version that replaced the link. So the trigger here **is still a link**:
 * it carries a real `href`, middle-click and ⌘/Ctrl-click open the cart page,
 * and with JavaScript off it is the only behaviour there is. The panel is what
 * a plain left-click gets instead of a page load.
 *
 * That is worth having because the cart is the one header destination a shopper
 * opens mid-task — to check what is in it before adding the next thing — and
 * navigating away to answer that question loses their place on the page.
 *
 * It stays deliberately thin: lines, a subtotal, and two ways out. Coupons
 * and tax belong on the cart page, where there is room
 * to explain them and where the totals are recomputed server-side anyway.
 */
export function CartDrawer({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
}) {
  const { cart } = useCart();
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = React.useState(pathname);

  // Navigating closes the panel, or the visitor lands on a page they cannot
  // see. Adjusted during render rather than in an effect, which would paint the
  // new page behind the panel for a frame first.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0" aria-describedby={undefined}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <DialogPrimitive.Title className="text-base font-semibold">
            {cart.itemCount > 0 ? `Your cart (${cart.itemCount})` : 'Your cart'}
          </DialogPrimitive.Title>
        </div>

        {cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <span aria-hidden className="grid size-14 place-items-center rounded-full bg-surface-alt text-muted">
              <ShoppingCart className="size-6" />
            </span>
            <p className="text-sm text-muted">Your cart is empty.</p>
            <Link
              href="/shop"
              onClick={() => onOpenChange(false)}
              className="rounded-(--radius-button) border border-border-strong px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            >
              Continue shopping
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-y-auto px-5">
              {cart.lines.map((line) => (
                <li key={line.id} className="py-4">
                  <CartLineItem line={line} currency={cart.totals.currency} locale={locale} compact />
                </li>
              ))}
            </ul>

            <div className="border-t border-border px-5 py-4">
              {/*
                Subtotal only, and it says so. A "total" here that checkout then
                revised would be the number the shopper remembers.
              */}
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">Subtotal</span>
                <span className="text-lg font-semibold">
                  {formatMoney(cart.totals.subtotal, cart.totals.currency, locale)}
                </span>
              </div>
              <p className="mt-1 text-xs text-subtle">Final total confirmed at checkout.</p>

              <div className="mt-4 grid gap-2">
                <Link
                  href="/checkout"
                  onClick={() => onOpenChange(false)}
                  className="rounded-(--radius-button) bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
                >
                  Checkout
                </Link>
                <Link
                  href="/cart"
                  onClick={() => onOpenChange(false)}
                  className="rounded-(--radius-button) border border-border-strong px-5 py-3 text-center text-sm font-medium transition-colors hover:border-primary hover:text-primary"
                >
                  View cart
                </Link>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * True when a click should be left to the browser.
 *
 * Middle-click, and any modifier, mean "open this somewhere else" — a panel
 * cannot honour that, so the `href` has to.
 */
export function opensElsewhere(event: React.MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
