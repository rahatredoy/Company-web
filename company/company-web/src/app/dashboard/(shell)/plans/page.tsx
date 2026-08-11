import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { BillingSetup } from '@/components/dashboard/billing-setup';
import { SubscriptionActions } from '@/components/dashboard/subscription-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Alert } from '@/components/ui/alert';
import { InfoList, InfoRow } from '@/components/dashboard/info-row';
import { serverGetOptional } from '@/lib/server-api';
import { billingGate } from '@/lib/billing-gate';
import { getPublicPlans, getPublicSettings } from '@/lib/public-data';
import { formatDate, formatMoney } from '@/lib/format';
import type { OnboardingState, StoreView, SubscriptionView } from '@/lib/types';

export const metadata: Metadata = { title: 'Plans & Billing', robots: { index: false, follow: false } };

export default async function PlansPage() {
  const [subscription, signup, store, plans, settings] = await Promise.all([
    serverGetOptional<SubscriptionView>('/api/v1/client/subscription'),
    serverGetOptional<OnboardingState>('/api/v1/client/onboarding'),
    serverGetOptional<StoreView>('/api/v1/client/store'),
    getPublicPlans(),
    getPublicSettings(),
  ]);

  const trial = subscription?.trial ?? null;
  // Nothing in this dashboard is unlocked by choosing a plan — only by the bill
  // for it settling, at whatever amount that bill came to, 0.00 included.
  const gate = billingGate(signup);

  if (!gate.complete) {
    return (
      <>
        <PageHeader
          title="Billing"
          description="Set up your billing and pay the bill. This is the first step — your store, its admin panel and the rest of your dashboard open the moment it clears."
        />

        <Card>
          <CardContent className="p-5 sm:p-6">
            <BillingSetup plans={plans} trialDays={settings.trialDays} signup={signup} />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Plans & subscription"
        description="Your current plan, billing cycle and renewal — and every plan you can move to."
        actions={
          !store ? (
            <Button asChild>
              <Link href="/dashboard/store">
                Create your store <ArrowRight />
              </Link>
            </Button>
          ) : null
        }
      />

      {!store ? (
        <Alert variant="success" title={`${subscription!.plan!.name} is active`}>
          Your plan is unlocked. Create your store to get your storefront, admin panel and database.
        </Alert>
      ) : null}

      {subscription?.status === 'cancelled' ? (
        <Alert variant="warning" title="Subscription cancelled">
          Your store stays online until {formatDate(subscription.renewalAt)}. Reactivate any time before
          then to keep it running without interruption.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoList>
              <InfoRow label="Plan" value={subscription?.plan?.name ?? 'No active plan'} />
              <InfoRow
                label="Status"
                value={subscription ? <StatusBadge status={subscription.status} /> : '—'}
              />
              <InfoRow
                label="Billing cycle"
                value={
                  subscription?.billingCycle
                    ? subscription.billingCycle === 'monthly'
                      ? 'Monthly'
                      : 'Yearly'
                    : '—'
                }
              />
              <InfoRow label="Price" value={subscription?.price ? formatMoney(subscription.price) : '—'} />
              <InfoRow label="Started" value={formatDate(subscription?.startedAt)} />
              <InfoRow label="Renews on" value={formatDate(subscription?.renewalAt)} />
              {subscription?.cancelledAt ? (
                <InfoRow label="Cancelled on" value={formatDate(subscription.cancelledAt)} />
              ) : null}
            </InfoList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Free trial</CardTitle>
          </CardHeader>
          <CardContent>
            {trial ? (
              <InfoList>
                <InfoRow label="Status" value={<StatusBadge status={trial.status} />} />
                <InfoRow label="Started" value={formatDate(trial.startedAt)} />
                <InfoRow label="Ends" value={formatDate(trial.endsAt)} />
                <InfoRow
                  label="Days remaining"
                  value={trial.status === 'active' ? `${trial.daysRemaining} days` : '—'}
                />
              </InfoList>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">
                No trial on this account. Your subscription is billed from the start of the period.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <SubscriptionActions subscription={subscription} plans={plans} />
        </CardContent>
      </Card>
    </>
  );
}
