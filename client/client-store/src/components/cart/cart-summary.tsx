'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { Cart } from '@/types';
import { Button } from '@/components/ui/button';
import { formatMoney, pluralise } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { CouponForm } from './coupon-form';

/**
 * Order summary.
 *
 * Shipping reads "Calculated at checkout" rather than "Free" or "—" until an
 * address exists, because the storefront genuinely does not know it yet and
 * either alternative is a claim.
 *
 * Every figure here is the browser's optimistic view. The server recalculates
 * at checkout against live prices, live stock and the real coupon rules, and
 * that is what gets charged — which is why the line under the button says so
 * rather than presenting this total as final.
 */
export function CartSummary({
  cart,
  locale,
  showCoupon = true,
  action,
  className,
}: {
  cart: Cart;
  locale: string;
  showCoupon?: boolean;
  action?: React.ReactNode;
  className?: string;
}) {
  const currency = cart.totals.currency;
  const hasDiscount = Number.parseFloat(cart.totals.discount) > 0;
  const blocked = cart.lines.some((line) => !line.inStock);

  return (
    <div className={cn('rounded-(--radius-card) border border-border bg-surface p-5 sm:p-6', className)}>
      <h2 className="text-lg font-semibold">Order summary</h2>

      {showCoupon ? (
        <div className="mt-5">
          <CouponForm cart={cart} currency={currency} locale={locale} />
        </div>
      ) : null}

      <dl className="mt-5 space-y-2.5 border-t border-border pt-5 text-sm">
        <Row
          label={`Subtotal (${cart.itemCount} ${pluralise(cart.itemCount, 'item')})`}
          value={formatMoney(cart.totals.subtotal, currency, locale)}
        />

        {hasDiscount ? (
          <Row
            label={cart.coupon ? `Discount (${cart.coupon.code})` : 'Discount'}
            value={`− ${formatMoney(cart.totals.discount, currency, locale)}`}
            tone="success"
          />
        ) : null}

        <Row
          label="Shipping"
          value={
            cart.totals.shipping === null
              ? 'Calculated at checkout'
              : formatMoney(cart.totals.shipping, currency, locale)
          }
          muted={cart.totals.shipping === null}
        />

        <Row label="Tax" value={formatMoney(cart.totals.tax, currency, locale)} />
      </dl>

      <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
        <p className="text-base font-semibold">Total</p>
        <p className="text-xl font-bold tabular-nums">
          {formatMoney(cart.totals.total, currency, locale)}
        </p>
      </div>

      {blocked ? (
        <p role="alert" className="mt-4 text-xs font-medium text-error">
          Remove the out-of-stock items above before checking out.
        </p>
      ) : null}

      <div className="mt-5">
        {action ?? (
          <Button asChild size="lg" className="w-full" disabled={blocked}>
            <Link href="/checkout">Proceed to checkout</Link>
          </Button>
        )}
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-subtle">
        <Lock className="size-3.5" aria-hidden />
        Secure checkout. Final totals confirmed before you pay.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'success';
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn(
          'shrink-0 tabular-nums',
          tone === 'success' && 'font-medium text-success',
          muted && 'text-xs text-subtle',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
