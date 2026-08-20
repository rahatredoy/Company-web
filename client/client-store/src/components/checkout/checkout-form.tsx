'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { PaymentMethodOption, ShippingMethodOption } from '@/types';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { CartSummary } from '@/components/cart/cart-summary';
import { useCart } from '@/lib/commerce/cart';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { formatMoney, pluralise } from '@/lib/utils';

/**
 * One-page checkout: contact, address, delivery, payment, review.
 *
 * The submit sends product ids and quantities — **never prices**. The server
 * re-reads every price and re-applies the coupon from its own rules, and its
 * answer is what gets charged. That is why the totals on this page are labelled
 * as an estimate until the order comes back.
 *
 * The button disables itself for the whole request. A double-tapped Place Order
 * is the most expensive duplicate submission in a shop.
 */

const COUNTRIES = ['Bangladesh', 'India', 'Pakistan', 'Sri Lanka', 'Nepal'];

export function CheckoutForm({
  shippingMethods,
  paymentMethods,
  locale,
}: {
  shippingMethods: ShippingMethodOption[];
  paymentMethods: PaymentMethodOption[];
  locale: string;
}) {
  const router = useRouter();
  const { cart, clear } = useCart();
  const hydrated = useHydrated();

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [shippingMethodId, setShippingMethodId] = React.useState(shippingMethods[0]?.id ?? '');
  const [paymentProvider, setPaymentProvider] = React.useState(paymentMethods[0]?.provider ?? '');

  const currency = cart.totals.currency;
  const shippingMethod = shippingMethods.find((method) => method.id === shippingMethodId);
  const chosenPayment = paymentMethods.find((method) => method.provider === paymentProvider);

  const estimatedTotal = React.useMemo(() => {
    const base = Number.parseFloat(cart.totals.total);
    const delivery = shippingMethod ? Number.parseFloat(shippingMethod.price) : 0;
    return (base + delivery).toFixed(2);
  }, [cart.totals.total, shippingMethod]);

  if (hydrated && cart.lines.length === 0) {
    return (
      <Alert tone="info" title="Your cart is empty" className="mt-8">
        <p>
          There is nothing to check out.{' '}
          <Link href="/shop" className="font-medium text-primary hover:underline">
            Browse the shop
          </Link>{' '}
          and come back.
        </p>
      </Alert>
    );
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      email: value('email'),
      phone: value('phone'),
      /*
       * Ids, quantities and — for a product sold by weight — which size. No
       * money: the basket lives in `localStorage`, so every price here is a
       * number the customer could have edited, and the API re-derives all of it.
       * The size is sent for the same reason a quantity is: it is what was
       * asked for, not what it costs, and the API checks it against the
       * product's own list before pricing anything.
       */
      lines: cart.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        measure: line.measure,
      })),
      shippingAddress: {
        fullName: value('fullName'),
        phone: value('phone'),
        addressLine1: value('addressLine1'),
        addressLine2: value('addressLine2') || null,
        city: value('city'),
        state: value('state') || null,
        postalCode: value('postalCode') || null,
        country: value('country'),
      },
      shippingMethodId,
      paymentProvider,
      couponCode: cart.coupon?.code ?? null,
      notes: value('notes') || null,
    };

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as
        | { data?: { orderNumber: string; paymentRedirectUrl: string | null }; error?: string; details?: Record<string, string> }
        | null;

      if (!response.ok || !body?.data) {
        setError(body?.error ?? 'We could not place your order. Please try again.');
        if (body?.details) setFieldErrors(body.details);
        setSubmitting(false);
        return;
      }

      // The basket is cleared only once the server has confirmed an order
      // exists. Clearing optimistically loses the cart if placement failed.
      clear();

      if (body.data.paymentRedirectUrl) {
        window.location.href = body.data.paymentRedirectUrl;
        return;
      }

      router.push(`/checkout/success/${encodeURIComponent(body.data.orderNumber)}`);
    } catch {
      setError('We could not reach the store. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-10">
        <section>
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-1 text-sm text-muted">
            We will send your order confirmation and tracking here.{' '}
            <Link href="/login?next=/checkout" className="font-medium text-primary hover:underline">
              Sign in
            </Link>{' '}
            to use your saved details.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field name="email" label="Email" required error={fieldErrors.email}>
              {(props) => <Input {...props} type="email" autoComplete="email" placeholder="you@example.com" />}
            </Field>
            <Field name="phone" label="Phone" required error={fieldErrors.phone}>
              {(props) => <Input {...props} type="tel" autoComplete="tel" placeholder="+880 1700 000000" />}
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Delivery address</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              name="fullName"
              label="Full name"
              required
              className="sm:col-span-2"
              error={fieldErrors['shippingAddress.fullName']}
            >
              {(props) => <Input {...props} autoComplete="name" />}
            </Field>

            <Field
              name="addressLine1"
              label="Address"
              required
              className="sm:col-span-2"
              error={fieldErrors['shippingAddress.addressLine1']}
            >
              {(props) => <Input {...props} autoComplete="address-line1" placeholder="House, road, area" />}
            </Field>

            <Field
              name="addressLine2"
              label="Apartment, floor, landmark"
              hint="Optional"
              className="sm:col-span-2"
            >
              {(props) => <Input {...props} autoComplete="address-line2" />}
            </Field>

            <Field name="city" label="City" required error={fieldErrors['shippingAddress.city']}>
              {(props) => <Input {...props} autoComplete="address-level2" />}
            </Field>

            <Field name="state" label="District / State" hint="Optional">
              {(props) => <Input {...props} autoComplete="address-level1" />}
            </Field>

            <Field name="postalCode" label="Postal code" hint="Optional">
              {(props) => <Input {...props} autoComplete="postal-code" inputMode="numeric" />}
            </Field>

            <Field name="country" label="Country" required>
              {(props) => (
                <select
                  {...props}
                  defaultValue={COUNTRIES[0]}
                  autoComplete="country-name"
                  className="h-11 w-full rounded-(--radius-input) border border-border-strong bg-surface px-3.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25"
                >
                  {COUNTRIES.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Delivery method</h2>

          <RadioGroup
            value={shippingMethodId}
            onValueChange={setShippingMethodId}
            className="mt-4"
            aria-label="Delivery method"
          >
            {shippingMethods.map((method) => (
              <RadioCard
                key={method.id}
                id={`shipping-${method.id}`}
                value={method.id}
                title={method.name}
                description={
                  <>
                    {method.description}
                    {method.estimatedDaysMin !== null ? (
                      <>
                        {' · '}
                        {method.estimatedDaysMin === method.estimatedDaysMax
                          ? `${method.estimatedDaysMin} ${pluralise(method.estimatedDaysMin, 'day')}`
                          : `${method.estimatedDaysMin}–${method.estimatedDaysMax} days`}
                      </>
                    ) : null}
                  </>
                }
                trailing={formatMoney(method.price, currency, locale)}
              />
            ))}
          </RadioGroup>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Payment</h2>

          <RadioGroup
            value={paymentProvider}
            onValueChange={setPaymentProvider}
            className="mt-4"
            aria-label="Payment method"
          >
            {paymentMethods.map((method) => (
              <RadioCard
                key={method.provider}
                id={`payment-${method.provider}`}
                value={method.provider}
                title={method.label}
                description={method.description}
              />
            ))}
          </RadioGroup>

          {chosenPayment?.instructions ? (
            <p className="mt-3 text-sm text-muted">{chosenPayment.instructions}</p>
          ) : null}
        </section>

        <section>
          <h2 className="text-lg font-semibold">Order notes</h2>
          <Field name="notes" label="Anything we should know?" hint="Optional" className="mt-4">
            {(props) => (
              <Textarea {...props} rows={3} placeholder="Delivery instructions, a gift message…" />
            )}
          </Field>
        </section>
      </div>

      <div className="lg:sticky lg:top-24">
        <CartSummary
          cart={cart}
          locale={locale}
          showCoupon={false}
          action={
            <div className="space-y-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">Delivery</span>
                <span className="tabular-nums">
                  {shippingMethod ? formatMoney(shippingMethod.price, currency, locale) : '—'}
                </span>
              </div>

              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="font-semibold">Estimated total</span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoney(estimatedTotal, currency, locale)}
                </span>
              </div>

              {error ? (
                <p role="alert" className="text-sm font-medium text-error">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? <Spinner /> : <Lock aria-hidden />}
                {submitting ? 'Placing your order…' : 'Place order'}
              </Button>

              <p className="text-center text-xs text-subtle">
                Final totals are confirmed by our server before you are charged.
              </p>
            </div>
          }
        />
      </div>
    </form>
  );
}
