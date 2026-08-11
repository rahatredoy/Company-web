'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toaster';
import { formatMoney } from '@/lib/format';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Plan, SubscriptionView } from '@/lib/types';

export function SubscriptionActions({
  subscription,
  plans,
}: {
  subscription: SubscriptionView | null;
  plans: Plan[];
}) {
  const router = useRouter();
  const [cycle, setCycle] = React.useState<'monthly' | 'yearly'>(subscription?.billingCycle ?? 'monthly');
  const [pendingPlanId, setPendingPlanId] = React.useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const currentPlanId = subscription?.plan?.id ?? null;
  // The trial is where a store starts, never somewhere it moves to — it is
  // taken once per account, and everyone here has already had that one. The API
  // refuses it on both routes; this keeps the offer off the page as well.
  const choosablePlans = plans.filter((plan) => !plan.isTrial);
  const pendingPlan = choosablePlans.find((p) => p.id === pendingPlanId) ?? null;
  const onTrialPlan = Boolean(subscription?.plan?.isTrial);

  const isDowngrade =
    pendingPlan && subscription?.plan
      ? Number.parseFloat(pendingPlan.monthlyPrice) < Number.parseFloat(subscription.plan.monthlyPrice)
      : false;

  const changePlan = async () => {
    if (!pendingPlanId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ checkoutUrl?: string }>('/api/v1/client/subscription/change', {
        planId: pendingPlanId,
        billingCycle: cycle,
      });
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.success('Plan updated');
      setPendingPlanId(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/client/subscription/cancel');
      toast.success('Subscription cancelled', {
        description: 'Your store stays online until the end of the current period.',
      });
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ checkoutUrl?: string }>('/api/v1/client/subscription/reactivate');
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.success('Subscription reactivated');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const canCancel = subscription && ['active', 'trial', 'past_due'].includes(subscription.status);
  // A trial has nothing to reactivate — renewing it would be a second free week.
  // What brings that store back is buying one of the plans above.
  const canReactivate =
    subscription && !onTrialPlan && ['cancelled', 'expired', 'suspended'].includes(subscription.status);

  return (
    <div className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {onTrialPlan ? (
        <Alert variant="info" title="You are on the free trial">
          The trial runs once and is never renewed. Choose a plan below to keep your store online after
          it ends — your storefront, admin panel and data stay exactly as they are.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Change plan</h2>
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
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                cycle === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {choosablePlans.map((plan) => {
          const current = plan.id === currentPlanId && cycle === subscription?.billingCycle;
          const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;

          return (
            <div
              key={plan.id}
              className={cn(
                'flex flex-col rounded-xl border bg-card p-5',
                current ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{plan.name}</span>
                {current ? (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">
                    Current
                  </span>
                ) : null}
              </div>
              <span className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">{formatMoney(price)}</span>
                <span className="text-xs text-muted-foreground">/{cycle === 'monthly' ? 'mo' : 'yr'}</span>
              </span>
              <p className="mt-2 min-h-10 text-xs text-muted-foreground">{plan.description}</p>
              <Button
                className="mt-4 w-full"
                variant={current ? 'outline' : 'primary'}
                disabled={current || busy}
                onClick={() => setPendingPlanId(plan.id)}
              >
                {current ? 'Current plan' : 'Switch to this plan'}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        {canReactivate ? (
          <Button onClick={reactivate} loading={busy}>
            Reactivate subscription
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={busy}>
            Cancel subscription
          </Button>
        ) : null}
      </div>

      <Dialog open={!!pendingPlanId} onOpenChange={(open) => !open && setPendingPlanId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {pendingPlan?.name}?</DialogTitle>
            <DialogDescription>
              You will be billed {formatMoney(cycle === 'monthly' ? pendingPlan?.monthlyPrice : pendingPlan?.yearlyPrice)}{' '}
              per {cycle === 'monthly' ? 'month' : 'year'} from your next renewal.
            </DialogDescription>
          </DialogHeader>

          {isDowngrade ? (
            <Alert variant="warning" title="This is a downgrade">
              We check your current usage first. If your catalogue or team exceeds the smaller plan&apos;s
              limits, the change is blocked and nothing is deleted.
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPlanId(null)} disabled={busy}>
              Keep current plan
            </Button>
            <Button onClick={changePlan} loading={busy}>
              Confirm change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" aria-hidden />
              Cancel your subscription?
            </DialogTitle>
            <DialogDescription>
              Your store stays online until the end of the current billing period. After that it is
              paused — we never delete your data automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy}>
              Keep subscription
            </Button>
            <Button variant="destructive" onClick={cancel} loading={busy}>
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
