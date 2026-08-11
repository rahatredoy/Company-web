import Link from 'next/link';
import { ArrowRight, Check, CreditCard, Lock, Receipt } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BillingGate } from '@/lib/billing-gate';

/**
 * The two halves of billing, in the order they happen. Rendered wherever the
 * gate is shown so the same two steps are visible from every locked page — the
 * client should never have to work out which half they are missing.
 */
function BillingSteps({ gate }: { gate: BillingGate }) {
  const steps = [
    {
      icon: CreditCard,
      title: 'Set up billing',
      description: 'Pick your plan and how you want to be billed.',
      done: gate.planChosen,
    },
    {
      icon: Receipt,
      title: 'Pay your bill',
      description: gate.isTrial
        ? 'Your trial bill is 0.00 — it still has to be completed.'
        : 'Your store is created as soon as it clears.',
      done: gate.billPaid,
    },
  ];

  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      {steps.map((step, index) => {
        const current = !step.done && (index === 0 || steps[index - 1]!.done);
        return (
          <li
            key={step.title}
            className={cn(
              'flex gap-3 rounded-xl border p-4',
              step.done
                ? 'border-success/30 bg-success-soft'
                : current
                  ? 'border-primary bg-primary-soft'
                  : 'border-border bg-card',
            )}
          >
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-lg',
                step.done
                  ? 'bg-success text-success-foreground'
                  : current
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {step.done ? (
                <Check className="size-4" strokeWidth={3} aria-hidden />
              ) : (
                <step.icon className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold">
                {index + 1}. {step.title}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The card that sits above everything else in the dashboard until the bill is
 * paid. It is the first thing on the overview and the only thing on a locked
 * page — there is nothing else to do here yet, and pretending otherwise would
 * send someone off to configure a store they have not paid for.
 */
export function BillingRequired({
  gate,
  feature,
}: {
  gate: BillingGate;
  /** What was being opened, so the refusal names it. */
  feature?: string;
}) {
  const outstanding = gate.stage === 'plan';

  return (
    <Card className="overflow-hidden border-primary/40">
      <CardContent className="space-y-6 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
            {feature ? <Lock className="size-6" aria-hidden /> : <CreditCard className="size-6" aria-hidden />}
          </span>

          <div className="flex-1 space-y-2">
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {feature ? `${feature} unlocks once your bill is paid` : 'Set up billing to get started'}
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {outstanding
                ? 'Billing is the first step here. Choose your plan and settle the bill, and everything else in your account — your store, its admin panel and your domains — opens up straight after.'
                : gate.isTrial
                  ? `Your ${gate.planName ?? 'plan'} is on a free trial, so today's bill is ${formatMoney(gate.amountDue, gate.currency)}. It still has to go through checkout — that is what puts a card on file and lets us build your store.`
                  : `Your ${gate.planName ?? 'plan'} is waiting on a bill of ${formatMoney(gate.amountDue, gate.currency)}. Nothing else opens until it clears, and nothing is charged twice if you have already started.`}
            </p>
          </div>

          <div className="shrink-0">
            <Button asChild size="lg">
              <Link href={gate.href}>
                {gate.label} <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>

        <BillingSteps gate={gate} />
      </CardContent>
    </Card>
  );
}

/**
 * The persistent strip the dashboard shell keeps above every page while the
 * bill is outstanding. Deliberately smaller than the card above: it is a
 * reminder on pages that are still usable, not the page itself.
 */
export function BillingRequiredBanner({ gate }: { gate: BillingGate }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <CreditCard className="size-4" aria-hidden />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">
            {gate.stage === 'plan' ? 'Step 1 of 2 — set up billing' : 'Step 2 of 2 — pay your bill'}
          </p>
          <p className="text-xs text-muted-foreground">
            {gate.stage === 'plan'
              ? 'Your store is built once billing is set up and the bill is paid. Have a look at what it includes in the meantime.'
              : `${formatMoney(gate.amountDue, gate.currency)} due${gate.isTrial ? ' — your trial bill' : ''}. The rest of your dashboard unlocks the moment it clears.`}
          </p>
        </div>
      </div>

      <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
        <Link href={gate.href}>
          {gate.label} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
