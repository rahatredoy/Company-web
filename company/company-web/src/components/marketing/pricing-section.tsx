'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Minus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { SectionHeading } from './section-heading';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Plan } from '@/lib/types';

function yearlySaving(plan: Plan): number {
  const monthly = Number.parseFloat(plan.monthlyPrice);
  const yearly = Number.parseFloat(plan.yearlyPrice);
  if (!Number.isFinite(monthly) || !Number.isFinite(yearly) || monthly <= 0) return 0;
  return Math.max(0, monthly * 12 - yearly);
}

function planFeatures(plan: Plan): { label: string; included: boolean }[] {
  const limit = (value: number | null, singular: string) =>
    value === null ? `Unlimited ${singular}s` : `Up to ${value.toLocaleString('en-US')} ${singular}${value === 1 ? '' : 's'}`;

  const storage =
    plan.storageLimitMb === null
      ? 'Unlimited storage'
      : plan.storageLimitMb >= 1024
        ? `${Math.round(plan.storageLimitMb / 1024)}GB storage`
        : `${plan.storageLimitMb}MB storage`;

  const support =
    plan.supportLevel === 'dedicated'
      ? '24/7 dedicated support'
      : plan.supportLevel === 'priority'
        ? 'Priority support'
        : 'Email support';

  return [
    { label: limit(plan.productLimit, 'product'), included: true },
    { label: limit(plan.adminLimit, 'admin account'), included: true },
    { label: storage, included: true },
    { label: 'Custom storefront domain', included: plan.customDomainEnabled },
    { label: 'Custom admin domain', included: plan.customAdminDomainEnabled },
    { label: 'Reports', included: plan.reportsEnabled },
    { label: 'Analytics', included: plan.analyticsEnabled },
    { label: support, included: true },
  ];
}

export function PricingSection({
  plans,
  trialDays = 7,
  compact = false,
}: {
  plans: Plan[];
  trialDays?: number;
  compact?: boolean;
}) {
  const [cycle, setCycle] = React.useState<'monthly' | 'yearly'>('yearly');

  // The trial is a plan of its own, and the only one the cycle toggle does not
  // apply to. It leads the grid; the rest are bought.
  const trialPlan = plans.find((plan) => plan.isTrial) ?? null;
  const paidPlans = plans.filter((plan) => !plan.isTrial);

  const maxSavingPct = React.useMemo(() => {
    let best = 0;
    for (const plan of plans) {
      const monthly = Number.parseFloat(plan.monthlyPrice) * 12;
      const yearly = Number.parseFloat(plan.yearlyPrice);
      if (monthly > 0 && Number.isFinite(yearly)) {
        best = Math.max(best, Math.round(((monthly - yearly) / monthly) * 100));
      }
    }
    return best;
  }, [plans]);

  return (
    <section className="border-t border-border bg-surface py-20 sm:py-24" id="pricing">
      <div className="container-page space-y-10">
        <SectionHeading
          title={
            <>
              Simple, Transparent <span className="text-gradient">Pricing</span>
            </>
          }
          description="Choose the perfect plan for your business. Upgrade or downgrade anytime."
        />

        {plans.length === 0 ? (
          <Alert variant="warning" title="Pricing is temporarily unavailable" className="mx-auto max-w-xl">
            We could not load plans right now. Please refresh in a moment or contact support.
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-center gap-3">
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
              {maxSavingPct > 0 ? (
                <span className="rounded-md bg-success-soft px-2 py-1 text-xs font-medium text-success">
                  Save up to {maxSavingPct}%
                </span>
              ) : null}
            </div>

            {trialPlan ? (
              <article className="rounded-xl border border-primary bg-primary-soft/25 p-6 shadow-[0_0_0_1px_var(--primary)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-[10.5px] font-semibold text-primary-foreground">
                      <Sparkles className="size-3" aria-hidden />
                      Free trial
                    </span>
                    <h3 className="text-xl font-bold tracking-tight">
                      {trialPlan.name} — {trialDays} days free
                    </h3>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                      {trialPlan.description}. One trial per account. Your store goes live straight away
                      and pauses when the {trialDays} days are up, until you pick a plan — nothing is
                      charged automatically.
                    </p>
                  </div>
                  <div className="shrink-0 space-y-2 lg:text-right">
                    <span className="flex items-baseline gap-1 lg:justify-end">
                      <span className="text-3xl font-bold tracking-tight">{formatMoney('0.00')}</span>
                      <span className="text-sm text-muted-foreground">for {trialDays} days</span>
                    </span>
                    <Button asChild size="lg" className="w-full lg:w-auto">
                      <Link href={`/register?plan=${trialPlan.code}`}>Start free trial</Link>
                    </Button>
                  </div>
                </div>
              </article>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {paidPlans.map((plan) => {
                const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
                const saving = yearlySaving(plan);
                const features = planFeatures(plan);
                const highlighted = plan.isFeatured;

                return (
                  <article
                    key={plan.id}
                    className={cn(
                      'relative flex flex-col rounded-xl border bg-card p-6 transition-shadow',
                      highlighted
                        ? 'border-primary shadow-[0_0_0_1px_var(--primary),var(--shadow-raised)]'
                        : 'border-border shadow-[var(--shadow-soft)]',
                    )}
                  >
                    {highlighted ? (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10.5px] font-semibold text-primary-foreground">
                        Most Popular
                      </span>
                    ) : null}

                    <header className="space-y-1">
                      <h3 className="text-base font-semibold">{plan.name}</h3>
                      <p className="min-h-10 text-sm text-muted-foreground">{plan.description}</p>
                    </header>

                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-bold tracking-tight">{formatMoney(price)}</span>
                      <span className="text-sm text-muted-foreground">
                        /{cycle === 'monthly' ? 'month' : 'year'}
                      </span>
                    </div>
                    {cycle === 'yearly' && saving > 0 ? (
                      <p className="mt-1 text-xs font-medium text-success">
                        Save {formatMoney(saving)} yearly
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Billed {cycle}</p>
                    )}

                    {compact ? null : (
                      <ul className="mt-5 space-y-2.5 border-t border-border pt-5">
                        {features.map((feature) => (
                          <li
                            key={feature.label}
                            className={cn(
                              'flex items-start gap-2 text-sm',
                              feature.included ? '' : 'text-muted-foreground/70',
                            )}
                          >
                            {feature.included ? (
                              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                            ) : (
                              <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" aria-hidden />
                            )}
                            <span>{feature.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-6 pt-0">
                      <Button
                        asChild
                        className="w-full"
                        variant={highlighted ? 'primary' : 'outline'}
                        size="lg"
                      >
                        <Link href={`/register?plan=${plan.code}&cycle=${cycle}`}>
                          {plan.supportLevel === 'dedicated' ? 'Contact Sales' : 'Get Started'}
                        </Link>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Every plan comes with a free platform subdomain and a dedicated database. The{' '}
              {trialDays}-day trial is a plan of its own and can be taken once per account.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
