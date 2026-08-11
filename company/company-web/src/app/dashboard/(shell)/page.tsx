import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  ExternalLink,
  FileText,
  Settings2,
  Sparkles,
  Store as StoreIcon,
  Timer,
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { BillingRequired } from '@/components/dashboard/billing-required';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { GettingStarted, type GettingStartedTask } from '@/components/dashboard/getting-started';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
import { InfoList, InfoRow } from '@/components/dashboard/info-row';
import { CopyButton } from '@/components/dashboard/copy-button';
import { serverGetOptional } from '@/lib/server-api';
import { billingGate } from '@/lib/billing-gate';
import { getPublicSettings } from '@/lib/public-data';
import { formatDate, formatMoney } from '@/lib/format';
import type { AccountOverview, OnboardingState } from '@/lib/types';

export const metadata: Metadata = { title: 'Overview', robots: { index: false, follow: false } };

export default async function DashboardOverviewPage() {
  const [overview, signup, settings] = await Promise.all([
    serverGetOptional<AccountOverview>('/api/v1/client/overview'),
    serverGetOptional<OnboardingState>('/api/v1/client/onboarding'),
    getPublicSettings(),
  ]);

  const account = overview?.account ?? null;
  const store = overview?.store ?? null;
  const subscription = overview?.subscription ?? null;
  const trial = subscription?.trial ?? null;
  const invoice = overview?.latestInvoice ?? null;
  const business = overview?.business ?? null;

  const firstName = account?.fullName?.split(' ')[0] ?? null;
  const gate = billingGate(signup);
  const storeReady = store?.storeStatus === 'ready';

  const greeting = (
    <PageHeader
      title={firstName ? `Welcome back, ${firstName} 👋` : 'Overview'}
      description="Manage your subscription, store and platform account."
      actions={
        storeReady ? (
          <>
            <Button asChild variant="outline">
              <a href={store!.storefrontUrl} target="_blank" rel="noreferrer noopener">
                View store <ExternalLink />
              </a>
            </Button>
            <Button asChild>
              <a href={store!.adminUrl} target="_blank" rel="noreferrer noopener">
                Open store admin <ExternalLink />
              </a>
            </Button>
          </>
        ) : null
      }
    />
  );

  // ── State 1: the bill is outstanding ────────────────────────────────────────
  // Billing is the first thing on this dashboard and the only thing offered
  // until it is done, because it is the only thing that can be done: every other
  // route is locked and the API refuses every setup call behind them.
  if (!gate.complete) {
    return (
      <>
        {greeting}

        <BillingRequired gate={gate} />

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Not locked, on purpose: the store page lists every piece setup
              builds, unpaid, so the decision to pay is an informed one. */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Your store</CardTitle>
              <Button asChild variant="link" size="sm">
                <Link href="/dashboard/store">
                  Take a look <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 py-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                  <StoreIcon className="size-4" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">
                  Nothing is built yet. Your storefront, admin panel and your own database are created right
                  after your bill clears — setup takes a couple of minutes. Have a look at what you get
                  before you pay for it.
                </p>
              </div>
            </CardContent>
          </Card>

          <GettingStartedCard
            account={account}
            planChosen={gate.planChosen}
            billPaid={gate.billPaid}
            websiteDone={false}
            adminDone={false}
            storeReady={false}
            hasCustomDomain={false}
            adminUrl={null}
          />
        </div>
      </>
    );
  }

  // ── State 2: bill paid, store not built yet ─────────────────────────────────
  if (!storeReady) {
    const failed = store?.storeStatus === 'failed';
    const creating = store?.storeStatus === 'creating';
    const websiteDone = signup?.website?.configured ?? false;
    const adminDone = signup?.adminPanel?.configured ?? false;

    // Everything left is the store page's wizard, which resumes where it stopped.
    const nextLabel = creating
      ? 'View setup progress'
      : !websiteDone
        ? 'Set up your website'
        : !adminDone
          ? 'Set up your admin panel'
          : 'Finish setting up my store';

    return (
      <>
        {greeting}

        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Your store setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <InfoList>
              <InfoRow label="Plan" value={subscription?.plan?.name ?? gate.planName ?? '—'} />
              <InfoRow
                label="Status"
                value={
                  failed ? (
                    <StatusBadge status="failed" />
                  ) : creating ? (
                    <Badge>Creating your store</Badge>
                  ) : !websiteDone && !adminDone ? (
                    <Badge>Waiting for setup</Badge>
                  ) : !websiteDone ? (
                    <Badge>Waiting for website setup</Badge>
                  ) : !adminDone ? (
                    <Badge>Waiting for admin panel setup</Badge>
                  ) : (
                    <Badge>Ready to build</Badge>
                  )
                }
              />
              <InfoRow label="Billing" value={<Badge variant="success">Paid</Badge>} />
              <InfoRow
                label="Plan price"
                value={
                  subscription?.price
                    ? `${formatMoney(subscription.price)} / ${subscription.billingCycle === 'yearly' ? 'year' : 'month'}`
                    : '—'
                }
              />
            </InfoList>

            {failed ? (
              <Alert variant="danger" title="Setup did not finish">
                Nothing was charged twice and no trial days were used. Open your store to retry, or
                contact support.
              </Alert>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/dashboard/store">
                  {nextLabel} <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/dashboard/plans">Change plan</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <GettingStartedCard
            account={account}
            planChosen
            billPaid
            websiteDone={websiteDone}
            adminDone={adminDone}
            storeReady={false}
            hasCustomDomain={false}
            adminUrl={null}
          />

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Subscription</CardTitle>
              <Button asChild variant="link" size="sm">
                <Link href="/dashboard/plans">
                  Manage <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <InfoList>
                <InfoRow label="Plan" value={subscription?.plan?.name ?? '—'} />
                <InfoRow
                  label="Status"
                  value={subscription ? <StatusBadge status={subscription.status} /> : '—'}
                />
                <InfoRow label="Trial ends" value={formatDate(trial?.endsAt)} />
              </InfoList>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // ── State 3: active client ──────────────────────────────────────────────────
  // The bar has to be drawn against the trial length this platform actually
  // grants, not a number baked in here — a 7-day trial on a 30-day scale reads
  // as almost untouched on its last day.
  const trialTotal = Math.max(1, settings.trialDays);
  const trialUsedPct =
    trial?.daysRemaining !== undefined
      ? Math.max(0, Math.min(100, ((trialTotal - trial.daysRemaining) / trialTotal) * 100))
      : 0;

  return (
    <>
      {greeting}

      {subscription?.status === 'past_due' ? (
        <Alert variant="danger" title="Payment failed">
          Your last payment could not be processed. Update your payment to keep your store online.{' '}
          <Link href="/dashboard/plans" className="font-medium text-primary hover:underline">
            Manage subscription
          </Link>
        </Alert>
      ) : null}

      {trial?.status === 'active' && trial.daysRemaining <= 5 ? (
        <Alert variant="warning" title={`Your trial ends in ${trial.daysRemaining} days`}>
          Choose a plan now so your storefront and admin panel stay online.{' '}
          <Link href="/dashboard/plans" className="font-medium text-primary hover:underline">
            Choose a plan
          </Link>
        </Alert>
      ) : null}

      {trial?.status === 'expired' && subscription?.status !== 'active' ? (
        <Alert variant="danger" title="Your trial has ended">
          Your store is paused — nothing has been deleted. Subscribe to bring it back online.{' '}
          <Link href="/dashboard/plans" className="font-medium text-primary hover:underline">
            Subscribe now
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-1 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Current plan</p>
              <CreditCard className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-xl font-bold">{subscription?.plan?.name ?? 'No plan yet'}</p>
            <p className="text-xs text-muted-foreground">
              {subscription?.price
                ? `${formatMoney(subscription.price)} / ${subscription.billingCycle === 'yearly' ? 'year' : 'month'}`
                : '—'}
            </p>
            {subscription ? <StatusBadge status={subscription.status} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Trial</p>
              <Timer className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-xl font-bold">
              {trial?.status === 'active' ? `${trial.daysRemaining} days left` : trial ? 'Ended' : '—'}
            </p>
            {trial?.status === 'active' ? (
              <>
                <p className="text-xs text-muted-foreground">Ends {formatDate(trial.endsAt)}</p>
                <Progress value={trialUsedPct} className="mt-2 h-1.5" />
              </>
            ) : trial ? (
              <StatusBadge status={trial.status} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">My store</p>
              <StoreIcon className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="truncate text-xl font-bold">{store!.storeName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {store!.customDomain ?? store!.platformSubdomain}
            </p>
            <StatusBadge status={store!.status} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Latest invoice</p>
              <FileText className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-xl font-bold">
              {invoice ? formatMoney(invoice.amount, invoice.currency) : '—'}
            </p>
            {invoice ? (
              <>
                <p className="text-xs text-muted-foreground">{formatDate(invoice.issuedAt)}</p>
                <StatusBadge status={invoice.status} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No invoices yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <QuickActions store={store} />

      <GettingStartedCard
        account={account}
        planChosen
        billPaid
        websiteDone
        adminDone
        storeReady
        hasCustomDomain={Boolean(store!.customDomain)}
        adminUrl={store!.adminUrl}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Your store</CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/dashboard/store">
                Details <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <InfoList>
              <InfoRow label="Store name" value={store!.storeName} />
              <InfoRow
                label="Tenant ID"
                value={
                  <span className="inline-flex items-center gap-1">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{store!.tenantId}</code>
                    <CopyButton value={store!.tenantId} label="" />
                  </span>
                }
              />
              <InfoRow
                label="Storefront"
                value={
                  <a
                    href={store!.storefrontUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    {store!.customDomain ?? store!.platformSubdomain}
                  </a>
                }
              />
              <InfoRow
                label="Store admin"
                value={
                  <a
                    href={store!.adminUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    Open admin
                  </a>
                }
              />
              <InfoRow label="Custom domain" value={store!.customDomain ?? <Badge>Not connected</Badge>} />
            </InfoList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Store admin panel</CardTitle>
            <Settings2 className="size-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent className="flex h-full flex-col justify-between gap-5">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Products, orders, customers, inventory, delivery and your store&apos;s design all live in
                your own admin panel.
              </p>
              {business?.businessName ? (
                <p className="flex items-center gap-1.5 text-sm">
                  <Sparkles className="size-3.5 text-primary" aria-hidden />
                  <span className="text-muted-foreground">Signed in as</span>
                  <span className="font-medium">{business.businessName}</span>
                </p>
              ) : null}
            </div>
            <Button asChild size="lg">
              <a href={store!.adminUrl} target="_blank" rel="noreferrer noopener">
                Open store admin <ExternalLink />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function GettingStartedCard({
  account,
  planChosen,
  billPaid,
  websiteDone,
  adminDone,
  storeReady,
  hasCustomDomain,
  adminUrl,
}: {
  account: AccountOverview['account'] | null;
  planChosen: boolean;
  billPaid: boolean;
  websiteDone: boolean;
  adminDone: boolean;
  storeReady: boolean;
  hasCustomDomain: boolean;
  adminUrl: string | null;
}) {
  const tasks: GettingStartedTask[] = [
    {
      key: 'account',
      label: 'Create your account',
      description: 'Done when you signed up.',
      done: Boolean(account),
    },
    {
      key: 'verify',
      label: 'Verify your email',
      description: 'Confirms we can reach you about billing and your store.',
      done: account?.emailVerified ?? false,
    },
    {
      key: 'plan',
      label: 'Set up billing',
      description: 'Your plan and billing cycle — this sets what your store can do.',
      done: planChosen,
      href: '/dashboard/plans',
    },
    {
      key: 'payment',
      label: 'Pay your bill',
      description: 'Nothing else opens until this clears. A trial is billed 0.00 and still goes through.',
      done: billPaid,
      href: '/dashboard/plans',
    },
    {
      key: 'website',
      label: 'Set up your website',
      description: 'Your store name and the address customers shop at.',
      done: websiteDone || storeReady,
      href: '/dashboard/store',
    },
    {
      key: 'admin-panel',
      label: 'Set up your admin panel',
      description: 'Its address, and the login that opens it.',
      done: adminDone || storeReady,
      href: '/dashboard/store',
    },
    {
      key: 'products',
      label: 'Add your first product',
      description: 'Happens inside your store admin panel.',
      done: false,
      href: adminUrl ?? undefined,
      external: Boolean(adminUrl),
      optional: true,
    },
    {
      key: 'domain',
      label: 'Connect a custom domain',
      description: 'Use your own address instead of the free platform one.',
      done: hasCustomDomain,
      href: '/dashboard/store',
      optional: true,
    },
  ];

  return <GettingStarted tasks={tasks} />;
}
