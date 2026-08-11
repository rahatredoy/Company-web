import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: 'Payment problem',
  robots: { index: false, follow: false },
};

/**
 * Payment failure.
 *
 * Distinguishes **payment failed** from **order not created**, because what the
 * customer should do next is completely different:
 *
 * - Payment failed on an order that exists → retry the payment, or pick another
 *   method. Do not place a second order.
 * - The order was never created → nothing was charged and nothing is reserved,
 *   so go back to the cart and try again.
 *
 * Getting this wrong is how a shop ends up with duplicate orders from a
 * customer who was told "something went wrong" and reasonably tried again.
 */
export default async function CheckoutFailurePage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; reason?: string }>;
}) {
  const { order, reason } = await searchParams;
  const orderExists = Boolean(order);

  return (
    <div className="container-store max-w-xl py-12">
      <div className="text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-error/12 text-error">
          <AlertTriangle className="size-7" aria-hidden />
        </span>

        <h1 className="text-2xl font-semibold sm:text-3xl">
          {orderExists ? 'Payment was not completed' : 'Your order was not placed'}
        </h1>

        <p className="mt-3 text-muted">
          {orderExists
            ? 'Your order is saved and nothing has been charged. You can try the payment again or choose another method.'
            : 'Nothing has been charged and your basket is untouched. Please try again.'}
        </p>
      </div>

      {orderExists ? (
        <Alert tone="info" title={`Order ${order}`} className="mt-8">
          Do not place a second order — this one is waiting for payment.
        </Alert>
      ) : null}

      {/* A provider's own reason code, when it passed one back. Never a stack. */}
      {reason ? (
        <p className="mt-4 text-center text-xs text-subtle">
          Reference: <code className="font-mono">{reason.slice(0, 64)}</code>
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {orderExists ? (
          <>
            <Button asChild size="lg">
              <Link href={`/account/orders/${order}`}>View order</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/checkout">Try payment again</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild size="lg">
              <Link href="/checkout">Back to checkout</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/cart">View cart</Link>
            </Button>
          </>
        )}
      </div>

      <p className="mt-8 text-center text-sm text-muted">
        Still stuck?{' '}
        <Link href="/contact" className="font-medium text-primary hover:underline">
          Contact us
        </Link>{' '}
        and we will sort it out.
      </p>
    </div>
  );
}
