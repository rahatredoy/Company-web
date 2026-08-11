'use client';

import * as React from 'react';
import { Tag, X } from 'lucide-react';
import type { Cart } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCart, couponMinimum, type CouponError } from '@/lib/commerce/cart';
import { formatMoney } from '@/lib/utils';

/**
 * Coupon entry.
 *
 * Each refusal gets its own sentence. "Invalid coupon" for a code that is real
 * but needs a larger basket sends people away thinking they mistyped it, when
 * what they needed was to be told how much more to spend.
 *
 * The store applies the discount at checkout from its own rules; what happens
 * here is the optimistic view.
 */
export function CouponForm({
  cart,
  currency,
  locale,
}: {
  cart: Cart;
  currency: string;
  locale: string;
}) {
  const { applyCoupon, removeCoupon } = useCart();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const message = (reason: CouponError, entered: string): string => {
    switch (reason) {
      case 'invalid':
        return 'That code is not recognised. Check it and try again.';
      case 'minimum_not_met': {
        const minimum = couponMinimum(entered);
        return minimum
          ? `This code needs a subtotal of at least ${formatMoney(String(minimum / 100), currency, locale)}.`
          : 'Your basket does not meet this code’s minimum.';
      }
      case 'already_applied':
        return 'That code is already applied.';
      case 'empty_cart':
        return 'Add something to your basket first.';
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const entered = code.trim();
    if (!entered) return;

    const result = applyCoupon(entered);
    if (result.ok) {
      setCode('');
      setError(null);
    } else {
      setError(message(result.reason, entered));
    }
  };

  if (cart.coupon) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-(--radius-button) border border-success/30 bg-success/8 px-3 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <Tag className="size-4 shrink-0 text-success" aria-hidden />
          <span className="truncate">
            <span className="font-semibold">{cart.coupon.code}</span>
            {cart.coupon.label ? <span className="text-muted"> · {cart.coupon.label}</span> : null}
          </span>
        </p>

        <button
          type="button"
          onClick={removeCoupon}
          aria-label={`Remove coupon ${cart.coupon.code}`}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-error"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="coupon-code" className="mb-1.5 block text-sm font-medium">
        Coupon code
      </label>

      <div className="flex gap-2">
        <Input
          id="coupon-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          placeholder="Enter code"
          autoComplete="off"
          autoCapitalize="characters"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'coupon-error' : undefined}
          className="uppercase"
        />
        <Button type="submit" variant="outline" disabled={!code.trim()}>
          Apply
        </Button>
      </div>

      {error ? (
        <p id="coupon-error" role="alert" className="mt-1.5 text-xs font-medium text-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
