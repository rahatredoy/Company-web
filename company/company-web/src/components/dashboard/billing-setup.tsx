'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Minus, Receipt, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { api, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OnboardingState, Plan } from '@/lib/types';

function limitLabel(value: number | null, singular: string) {
  return value === null
    ? `Unlimited ${singular}s`
    : `Up to ${value.toLocaleString('en-US')} ${singular}${value === 1 ? '' : 's'}`;
}

const STEPS = ['Billing setup', 'Pay your bill'] as const;

function Stepper({ current }: { current: 0 | 1 }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, index) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
              index < current
                ? 'bg-success text-success-foreground'
                : index === current
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {index < current ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : index + 1}
          </span>
          <span
            className={cn(
              'text-xs font-medium whitespace-nowrap',
              index === current ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Billing, in the two steps it actually has: set it up, then pay the bill it
 * produced. They were one click before — picking a plan threw you straight at
 * the gateway — which meant nobody ever saw what they were about to be charged,
 * and a trial looked like it had skipped billing altogether when it had not.
 *
 * The trial is a plan of its own here, not a checkbox on the others: it is
 * taken once per account for life, it runs out rather than converting, and
 * every other plan is bought outright. The server decides whether it may still
 * be offered (`trialOffer.available`) — this only draws or omits the card.
 *
 * A trial and a free plan both produce a bill of 0.00, and both still go through
 * checkout. The amount is the only thing that changes; the process does not,
 * because "the bill was paid" is what the rest of the dashboard unlocks on.
 *
 * Nothing here is trusted until the gateway's signed webhook says so — never the
 * redirect back, which proves nothing — so the page polls the server state.
 */
export function BillingSetup({
  plans,
  trialDays,
  signup,
}: {
  plans: Plan[];
  trialDays: number;
  signup: OnboardingState | null;
}) {
  const router = useRouter();

  // Where the gateway sent the browser back to. Read through `useSearchParams`
  // rather than `window.location` in an effect: the server sees the same query
  // string on this dynamic page, so the first paint is already the right one
  // instead of a correct render followed immediately by a corrected one.
  const paymentOutcome = useSearchParams().get('payment');

  const [cycle, setCycle] = React.useState<'monthly' | 'yearly'>(
    (signup?.plan?.billingCycle as 'monthly' | 'yearly') ?? 'monthly',
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(
    paymentOutcome === 'cancelled'
      ? 'The payment was cancelled. Nothing has been charged — you can try again below.'
      : null,
  );
  const [confirming, setConfirming] = React.useState(paymentOutcome === 'success');

  // A plan already chosen means billing setup is behind us and only the bill is
  // outstanding — a reload lands straight back on it rather than asking again.
  const chosenPlanId = signup?.plan?.planId ?? null;
  const [step, setStep] = React.useState<0 | 1>(chosenPlanId ? 1 : 0);
  const [selectedId, setSelectedId] = React.useState<string | null>(chosenPlanId);

  const trialPlan = plans.find((plan) => plan.isTrial) ?? null;
  const paidPlans = plans.filter((plan) => !plan.isTrial);
  // Offered only when the server says so. Without a state to read, the trial is
  // not drawn: the plan step would refuse it anyway, and a card that fails on
  // click is worse than one that was never there.
  const trialAvailable = Boolean(trialPlan) && (signup?.trialOffer?.available ?? false);

  const selected = plans.find((plan) => plan.id === selectedId) ?? null;
  const currency = signup?.payment?.currency ?? 'USD';

  // The server is authoritative about the amount once a plan is saved; before
  // that the plan card's own price is all there is.
  const planPrice =
    signup?.payment?.planPrice ??
    (selected ? (cycle === 'monthly' ? selected.monthlyPrice : selected.yearlyPrice) : '0.00');
  // `method_setup` also covers accounts part-way through the old flow, where the
  // trial sat on a paid plan and the bill showed it as a discount.
  const onTrial = signup?.payment?.mode === 'method_setup' || Boolean(selected?.isTrial);
  const amountDue = onTrial ? '0.00' : planPrice;

  // Take the gateway's marker back out of the address bar, so a refresh does not
  // replay the outcome. Purely a URL edit — the state above already has it.
  React.useEffect(() => {
    if (paymentOutcome) window.history.replaceState(null, '', window.location.pathname);
  }, [paymentOutcome]);

  React.useEffect(() => {
    if (!confirming) return;

    let attempts = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;

      try {
        const state = await api.get<OnboardingState>('/api/v1/client/onboarding');
        if (cancelled) return;
        if (state?.payment?.settled) {
          setConfirming(false);
          router.refresh();
          return;
        }
      } catch {
        // Keep polling — a transient failure is not a payment failure.
      }

      if (attempts >= 20) {
        setConfirming(false);
        setError(
          'We have not had confirmation from the payment provider yet. It can take a moment — refresh this page shortly.',
        );
        return;
      }

      timer = setTimeout(tick, 3000);
    };

    timer = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [confirming, router]);

  /** Step 1 → saves the plan and cycle. No money moves here. */
  const saveBillingSetup = async (planId: string) => {
    setError(null);
    setBusy(planId);
    try {
      await api.post('/api/v1/client/onboarding/plan', { planId, billingCycle: cycle });
      setSelectedId(planId);
      setStep(1);
      // Re-read so the bill is priced by the server, not by the card that was
      // clicked — the two must never be able to disagree.
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  /** Step 2 → the bill goes to the gateway, at whatever amount it came to. */
  const payBill = async () => {
    setError(null);
    setBusy('pay');
    try {
      const result = await api.post<{ settled: boolean; checkoutUrl: string | null }>(
        '/api/v1/client/onboarding/payment',
      );
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (confirming) {
    return (
      <div className="space-y-4 py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary-soft text-accent-foreground">
          <Loader2 className="size-6 animate-spin" />
        </span>
        <h2 className="text-xl font-bold tracking-tight">Confirming your payment</h2>
        <p className="text-sm text-muted-foreground">
          This only takes a few seconds. Your account unlocks as soon as it clears.
        </p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <Alert variant="warning" title="Plans are unavailable right now">
        We could not load the plan list. Refresh in a moment, or contact support if it keeps happening.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {step === 1 ? (
        <BillStep
          planName={selected?.name ?? signup?.planFeatures?.name ?? 'Your plan'}
          cycle={(signup?.plan?.billingCycle as 'monthly' | 'yearly') ?? cycle}
          planPrice={planPrice}
          amountDue={amountDue}
          currency={currency}
          onTrial={onTrial}
          trialPlan={Boolean(selected?.isTrial)}
          trialDays={trialDays}
          paying={busy === 'pay'}
          onPay={payBill}
          onBack={() => setStep(0)}
        />
      ) : (
        <>
          <div>
            <h2 className="text-base font-semibold">Set up your billing</h2>
            <p className="text-sm text-muted-foreground">
              Choose your plan and how you want to be billed. Nothing is charged on this step — you will
              see the bill before you pay it.
            </p>
          </div>

          {trialAvailable && trialPlan ? (
            <TrialPlanCard
              plan={trialPlan}
              trialDays={trialDays}
              chosen={selectedId === trialPlan.id}
              busy={busy === trialPlan.id}
              disabled={busy !== null && busy !== trialPlan.id}
              onChoose={() => saveBillingSetup(trialPlan.id)}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {trialAvailable ? 'Or start on a plan today' : 'Choose your plan'}
            </h3>
            <div
              role="radiogroup"
              aria-label="Billing cycle"
              className="inline-flex items-center rounded-lg border border-border bg-card p-1"
            >
              {(['monthly', 'yearly'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={cycle === value}
                  onClick={() => setCycle(value)}
                  className={cn(
                    'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                    cycle === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div role="radiogroup" aria-label="Plan" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {paidPlans.map((plan) => {
              const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
              const isBusy = busy === plan.id;

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col rounded-xl border bg-card p-5',
                    plan.isFeatured ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-border',
                  )}
                >
                  {plan.isFeatured ? (
                    <span className="absolute -top-2.5 right-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      Most Popular
                    </span>
                  ) : null}

                  <span className="text-sm font-semibold">{plan.name}</span>
                  <span className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold tracking-tight">{formatMoney(price)}</span>
                    <span className="text-xs text-muted-foreground">
                      /{cycle === 'monthly' ? 'mo' : 'yr'}
                    </span>
                  </span>
                  <p className="mt-2 min-h-10 text-xs text-muted-foreground">{plan.description}</p>

                  <ul className="mt-3 space-y-1.5 border-t border-border pt-4 text-xs">
                    <li className="flex items-center gap-1.5">
                      <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                      {limitLabel(plan.productLimit, 'product')}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                      {limitLabel(plan.adminLimit, 'admin')}
                    </li>
                    <li
                      className={cn(
                        'flex items-center gap-1.5',
                        !plan.customDomainEnabled && 'text-muted-foreground/70',
                      )}
                    >
                      {plan.customDomainEnabled ? (
                        <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                      ) : (
                        <Minus className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                      )}
                      Custom domain
                    </li>
                    <li
                      className={cn(
                        'flex items-center gap-1.5',
                        !plan.analyticsEnabled && 'text-muted-foreground/70',
                      )}
                    >
                      {plan.analyticsEnabled ? (
                        <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                      ) : (
                        <Minus className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                      )}
                      Analytics
                    </li>
                  </ul>

                  <Button
                    className="mt-5 w-full"
                    variant={plan.isFeatured ? 'primary' : 'outline'}
                    loading={isBusy}
                    disabled={busy !== null && !isBusy}
                    onClick={() => saveBillingSetup(plan.id)}
                  >
                    {selectedId === plan.id ? 'Continue' : 'Choose plan'} <ArrowRight />
                  </Button>
                </div>
              );
            })}
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
            You are taken to our payment provider’s own page to pay. Card details never reach our
            servers.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The trial, as the one plan it is. It sits above the paid grid rather than
 * inside it because the billing-cycle toggle does not apply to it and its price
 * is not a price — and because "free once, then choose a plan" is the whole
 * offer, which a fifth column of the same shape would flatten into a discount.
 */
function TrialPlanCard({
  plan,
  trialDays,
  chosen,
  busy,
  disabled,
  onChoose,
}: {
  plan: Plan;
  trialDays: number;
  chosen: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <div className="rounded-xl border border-primary bg-primary-soft/25 p-5 shadow-[0_0_0_1px_var(--primary)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
            <Sparkles className="size-3" aria-hidden />
            Free trial
          </span>
          <h3 className="text-lg font-bold tracking-tight">
            {plan.name} — {trialDays} days free
          </h3>
          <p className="max-w-xl text-sm text-muted-foreground">
            {plan.description} Your store goes live straight away. One trial per account — when the{' '}
            {trialDays} days are up your store pauses until you choose a plan, and nothing is charged
            automatically.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 text-xs">
            {[
              limitLabel(plan.productLimit, 'product'),
              limitLabel(plan.adminLimit, 'admin'),
              ...(plan.customDomainEnabled ? ['Custom domain'] : []),
              ...(plan.analyticsEnabled ? ['Analytics'] : []),
            ].map((label) => (
              <li key={label} className="flex items-center gap-1.5">
                <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 space-y-2 lg:text-right">
          <span className="flex items-baseline gap-1 lg:justify-end">
            <span className="text-3xl font-bold tracking-tight">{formatMoney('0.00')}</span>
            <span className="text-xs text-muted-foreground">for {trialDays} days</span>
          </span>
          <Button size="lg" className="w-full lg:w-auto" loading={busy} disabled={disabled} onClick={onChoose}>
            {chosen ? 'Continue' : 'Start free trial'} <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Step 2 — the bill itself, itemised, before anything is charged. */
function BillStep({
  planName,
  cycle,
  planPrice,
  amountDue,
  currency,
  onTrial,
  trialPlan,
  trialDays,
  paying,
  onPay,
  onBack,
}: {
  planName: string;
  cycle: 'monthly' | 'yearly';
  planPrice: string;
  amountDue: string;
  currency: string;
  onTrial: boolean;
  /** The trial plan itself, as opposed to an old-flow trial sitting on a paid plan. */
  trialPlan: boolean;
  trialDays: number;
  paying: boolean;
  onPay: () => void;
  onBack: () => void;
}) {
  const period = cycle === 'yearly' ? 'year' : 'month';
  // Only the old flow has a plan price to waive. On the trial plan there is
  // nothing behind the 0.00, so a "−0.00" line would be theatre.
  const waived = onTrial && Number(planPrice) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Your bill</h2>
        <p className="text-sm text-muted-foreground">
          {onTrial
            ? `Nothing is charged today. The bill is still raised and paid at ${formatMoney('0.00', currency)}, because that is what puts a card on file and lets us create your store.`
            : 'This is what you are paying now. Your store is created as soon as it clears.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Receipt className="size-4.5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">{planName}</p>
            <p className="text-xs text-muted-foreground">
              {trialPlan ? `Free for ${trialDays} days` : `Billed ${cycle === 'yearly' ? 'yearly' : 'monthly'}`}
            </p>
          </div>
        </div>

        <dl className="divide-y divide-border">
          <div className="flex items-center justify-between px-5 py-3 text-sm">
            <dt className="text-muted-foreground">
              {planName} · {trialPlan ? `${trialDays} days` : cycle === 'yearly' ? 'yearly' : 'monthly'}
            </dt>
            <dd className="font-medium">{formatMoney(planPrice, currency)}</dd>
          </div>

          {waived ? (
            <div className="flex items-center justify-between px-5 py-3 text-sm">
              <dt className="text-muted-foreground">{trialDays}-day free trial</dt>
              <dd className="font-medium text-success">−{formatMoney(planPrice, currency)}</dd>
            </div>
          ) : null}

          <div className="flex items-center justify-between bg-muted/30 px-5 py-4">
            <dt className="text-sm font-semibold">Due today</dt>
            <dd className="text-xl font-bold tracking-tight">{formatMoney(amountDue, currency)}</dd>
          </div>
        </dl>
      </div>

      {onTrial ? (
        <Alert variant="info" title={`Free for ${trialDays} days`}>
          {trialPlan ? (
            <>
              The clock only starts once your store is live. When the {trialDays} days are up your store
              pauses until you choose a plan — nothing is charged automatically, and nothing is deleted.
            </>
          ) : (
            <>
              {formatMoney(planPrice, currency)} per {period} starts when the trial ends, and the trial
              clock only starts once your store is live. Cancel before then and you are never charged.
            </>
          )}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={paying}>
          <ArrowLeft /> Change plan
        </Button>
        <Button size="lg" loading={paying} onClick={onPay}>
          {Number(amountDue) > 0 ? `Pay ${formatMoney(amountDue, currency)}` : 'Complete billing'}
          <ArrowRight />
        </Button>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
        You are taken to our payment provider’s own page — card details never reach our servers. Your plan
        unlocks only when the provider confirms it back to us, not when the page returns.
      </p>
    </div>
  );
}
