'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { Address, Customer, PaymentMethodOption } from '@/types';
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

/**
 * One-page checkout: contact, address, payment, review.
 *
 * The submit sends product ids and quantities — **never prices**. The server
 * re-reads every price and re-applies the coupon from its own rules, and its
 * answer is what gets charged. That is why the totals on this page are labelled
 * as an estimate until the order comes back.
 *
 * The button disables itself for the whole request. A double-tapped Place Order
 * is the most expensive duplicate submission in a shop.
 *
 * **The shopper is always signed in by the time this renders** — the page
 * redirects to `/login?next=/checkout` otherwise — so every box that the
 * account can answer opens already answered, and a session that expired between
 * the page loading and Place Order being pressed comes back as a 401 that sends
 * them to sign in rather than as "we could not place your order".
 */

const COUNTRIES = ['Bangladesh', 'India', 'Pakistan', 'Sri Lanka', 'Nepal'];

export function CheckoutForm({
  paymentMethods,
  locale,
  customer,
  savedAddress,
}: {
  paymentMethods: PaymentMethodOption[];
  locale: string;
  customer: Customer;
  savedAddress: Address | null;
}) {
  const router = useRouter();
  const { cart, clear } = useCart();
  const hydrated = useHydrated();

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [paymentProvider, setPaymentProvider] = React.useState(paymentMethods[0]?.provider ?? '');

  // A saved address may name a country this list does not, and dropping it
  // silently would post the order to the wrong one. Offer it instead.
  const countries = React.useMemo(
    () =>
      savedAddress && !COUNTRIES.includes(savedAddress.country)
        ? [savedAddress.country, ...COUNTRIES]
        : COUNTRIES,
    [savedAddress],
  );

  const chosenPayment = paymentMethods.find((method) => method.provider === paymentProvider);

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
      /*
       * The saved address this form opened filled in from, if there was one.
       * It is what turns a correction made here into an edit of that address
       * rather than a second copy of it beside the first — see
       * `rememberAddress` in the Commerce API. A first order sends null, and
       * the API writes the address as new.
       */
      shippingAddressId: savedAddress?.id ?? null,
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

      if (response.status === 401) {
        // The session went while the form was open. The basket is in
        // `localStorage`, so signing in returns them to a full checkout.
        router.push('/login?next=/checkout');
        return;
      }

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
            Signed in as{' '}
            <span className="font-medium text-foreground">
              {customer.email ?? customer.phone ?? 'your account'}
            </span>
            .{' '}
            {/*
              An account created from a phone number has no address to prefill,
              so the box below is empty and this is the first time anyone has
              asked for one. Saying what it is *for* is what makes that a
              reasonable thing to ask at a till.
            */}
            {customer.email
              ? 'We will send your order confirmation and updates here — change it below if you would rather they went somewhere else.'
              : 'We need an email address to send your order confirmation and updates to.'}{' '}
            <Link href="/account" className="font-medium text-primary hover:underline">
              Manage your details
            </Link>
            .
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field name="email" label="Email" required error={fieldErrors.email}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  defaultValue={customer.email ?? ''}
                />
              )}
            </Field>
            <Field name="phone" label="Phone" required error={fieldErrors.phone}>
              {(props) => (
                <Input
                  {...props}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+880 1700 000000"
                  defaultValue={savedAddress?.phone ?? customer.phone ?? ''}
                />
              )}
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Delivery address</h2>
          <p className="mt-1 text-sm text-muted">
            {savedAddress ? (
              <>
                Filled in from your saved address — anything you change here is saved back to it,
                so your next order opens with the address you actually used. See your{' '}
                <Link
                  href="/account/addresses"
                  className="font-medium text-primary hover:underline"
                >
                  address book
                </Link>
                .
              </>
            ) : (
              'We will save this address to your account, so you only have to type it once.'
            )}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              name="fullName"
              label="Full name"
              required
              className="sm:col-span-2"
              error={fieldErrors['shippingAddress.fullName']}
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="name"
                  defaultValue={savedAddress?.fullName ?? customer.fullName}
                />
              )}
            </Field>

            <Field
              name="addressLine1"
              label="Address"
              required
              className="sm:col-span-2"
              error={fieldErrors['shippingAddress.addressLine1']}
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="address-line1"
                  placeholder="House, road, area"
                  defaultValue={savedAddress?.addressLine1 ?? ''}
                />
              )}
            </Field>

            <Field
              name="addressLine2"
              label="Apartment, floor, landmark"
              hint="Optional"
              className="sm:col-span-2"
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="address-line2"
                  defaultValue={savedAddress?.addressLine2 ?? ''}
                />
              )}
            </Field>

            <Field name="city" label="City" required error={fieldErrors['shippingAddress.city']}>
              {(props) => (
                <Input {...props} autoComplete="address-level2" defaultValue={savedAddress?.city ?? ''} />
              )}
            </Field>

            <Field name="state" label="District / State" hint="Optional">
              {(props) => (
                <Input {...props} autoComplete="address-level1" defaultValue={savedAddress?.state ?? ''} />
              )}
            </Field>

            <Field name="postalCode" label="Postal code" hint="Optional">
              {(props) => (
                <Input
                  {...props}
                  autoComplete="postal-code"
                  inputMode="numeric"
                  defaultValue={savedAddress?.postalCode ?? ''}
                />
              )}
            </Field>

            <Field name="country" label="Country" required>
              {(props) => (
                <select
                  {...props}
                  defaultValue={savedAddress?.country ?? countries[0]}
                  autoComplete="country-name"
                  className="h-11 w-full rounded-(--radius-input) border border-border-strong bg-surface px-3.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25"
                >
                  {countries.map((country) => (
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
