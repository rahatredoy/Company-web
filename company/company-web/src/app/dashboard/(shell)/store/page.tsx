import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Cloud,
  ExternalLink,
  Headphones,
  KeyRound,
  LifeBuoy,
  MonitorCog,
  Package,
  Store as StoreIcon,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { AdminPasswordReset } from '@/components/dashboard/admin-password-reset';
import { ProvisioningProgress } from '@/components/dashboard/provisioning-progress';
import { StoreAddresses } from '@/components/dashboard/store-addresses';
import { StoreHero } from '@/components/dashboard/store-hero';
import { StoreNextSteps } from '@/components/dashboard/store-next-steps';
import { StoreQuickActions, StoreHelpCard } from '@/components/dashboard/store-quick-actions';
import { StoreSetupWizard } from '@/components/dashboard/store-setup-wizard';
import { StoreStatusCards } from '@/components/dashboard/store-status-cards';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { InfoList, InfoRow } from '@/components/dashboard/info-row';
import { serverGetOptional } from '@/lib/server-api';
import { billingGate } from '@/lib/billing-gate';
import type {
  AccountOverview,
  ClientMe,
  DomainView,
  OnboardingState,
  StoreUsageView,
  StoreView,
} from '@/lib/types';

export const metadata: Metadata = { title: 'My Store', robots: { index: false, follow: false } };

/** "10240" → "10 GB". Plans are stored in MB; nobody reads an allowance that way. */
function formatStorage(mb: number | null): string {
  if (mb === null) return 'Unlimited';
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`;
}

function formatLimit(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString('en-US');
}

/** Used storage, at the same scale the allowance beside it is written in. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * One usage row: what is being used, out of what the plan allows.
 *
 * `used` is null when the store platform has nothing to count yet — the bar is
 * dropped rather than drawn at zero, because an empty bar claims a measurement
 * that was never taken.
 */
function UsageRow({
  icon: Icon,
  label,
  used,
  limit,
  display,
}: {
  icon: LucideIcon;
  label: string;
  used: number | null;
  limit: number | null;
  display: string;
}) {
  const percent =
    used === null || limit === null || limit <= 0 ? null : Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="w-32 shrink-0 truncate text-sm text-muted-foreground">{label}</span>
      {percent === null ? <span className="flex-1" /> : <Progress value={percent} className="h-1.5 flex-1" />}
      <span className="shrink-0 text-sm font-medium whitespace-nowrap">{display}</span>
    </div>
  );
}

/** The "need a hand?" strip the states without a right-hand rail end on. */
function SupportBanner({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            <Headphones className="size-5" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        </div>
        <Button asChild>
          <Link href="/dashboard/support">
            <LifeBuoy /> Contact support
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Everything about the store, in one place: the setup wizard before it exists,
 * the build progress while it is being created, and afterwards the store's own
 * overview — both its addresses, the login that opens the panel, and what the
 * plan allows.
 *
 * Before and after are deliberately the same design: one hero carrying the store
 * (a rocket and four steps while it is a draft, the store itself once it is
 * real), then the cards that describe its pieces. Nothing moves position between
 * the two states except what is finally known.
 */
export default async function StorePage() {
  const [store, signup, account] = await Promise.all([
    serverGetOptional<StoreView>('/api/v1/client/store'),
    serverGetOptional<OnboardingState>('/api/v1/client/onboarding'),
    serverGetOptional<ClientMe>('/api/v1/client/me'),
  ]);

  const gate = billingGate(signup);

  // No store yet — including when the bill is still outstanding. This page is the
  // one being sold: it lays out every piece setup will build so the decision to
  // pay can be made by someone who has seen what they get. The bill is enforced
  // at the single button that starts setup, which explains itself when pressed,
  // and the shell keeps its banner above all of it. The API refuses every setup
  // call under the same rule, so nothing here is load-bearing.
  if (!store || store.storeStatus === 'not_created') {
    return (
      <>
        <PageHeader
          title="My Store"
          description={
            gate.complete
              ? 'Set up your website and admin panel, and we will build your store.'
              : 'This is everything we build for you. Setup starts once your bill is paid.'
          }
        />
        <StoreSetupWizard signup={signup} accountEmail={account?.email ?? ''} gate={gate} />
        <StoreStatusCards signup={signup} store={store} />
        <SupportBanner
          title={gate.complete ? 'Need help setting up your store?' : 'Questions before you pay?'}
          body="Our support team is here to help you at every step."
        />
      </>
    );
  }

  // Building, or a build that stopped: the progress view owns the page until it
  // settles either way.
  if (store.storeStatus === 'creating' || store.storeStatus === 'failed') {
    return (
      <>
        <PageHeader title="My Store" description="Your storefront, admin panel and database are being created." />
        <Card>
          <CardContent className="p-6 sm:p-8">
            <ProvisioningProgress initialStore={store} />
          </CardContent>
        </Card>
      </>
    );
  }

  // Live. Domains and the subscription are only fetched here because neither
  // exists in any meaningful form before the store does.
  const [overview, domains, usage] = await Promise.all([
    serverGetOptional<AccountOverview>('/api/v1/client/overview'),
    serverGetOptional<DomainView[]>('/api/v1/client/domains'),
    serverGetOptional<StoreUsageView>('/api/v1/client/store/usage'),
  ]);

  const ready = store.storeStatus === 'ready';
  const adminEmail = signup?.adminPanel?.adminEmail ?? null;
  const subscription = overview?.subscription ?? null;
  const plan = subscription?.plan ?? null;
  const trial = subscription?.trial ?? null;

  const storefrontDomain = domains?.find((row) => row.domainType === 'storefront_custom') ?? null;
  const adminDomain = domains?.find((row) => row.domainType === 'admin_custom') ?? null;

  return (
    <>
      <PageHeader
        title="Store overview"
        description="All the important details about your store."
        actions={
          ready ? (
            <>
              <Button asChild variant="outline">
                <a href={store.storefrontUrl} target="_blank" rel="noreferrer noopener">
                  <StoreIcon /> Visit my store <ExternalLink />
                </a>
              </Button>
              <Button asChild>
                <a href={store.adminUrl} target="_blank" rel="noreferrer noopener">
                  <MonitorCog /> Go to admin panel <ExternalLink />
                </a>
              </Button>
            </>
          ) : null
        }
      />

      {store.storeStatus === 'suspended' ? (
        <Alert variant="warning" title="Your store is suspended">
          Reactivate your subscription to bring the storefront and admin panel back online. Your data is
          untouched.
        </Alert>
      ) : null}

      {store.provisioningStatus === 'failed' ? (
        <Alert variant="danger" title="Provisioning failed">
          Our team has been notified.{' '}
          <Link href="/dashboard/support" className="font-medium text-primary hover:underline">
            Open a support ticket
          </Link>{' '}
          if this is not resolved shortly.
        </Alert>
      ) : null}

      <StoreHero store={store} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StoreAddresses
            store={store}
            storefrontDomain={storefrontDomain}
            adminDomain={adminDomain}
            customDomainAllowed={plan?.customDomainEnabled ?? false}
            customAdminDomainAllowed={plan?.customAdminDomainEnabled ?? false}
          />
        </div>

        <div className="space-y-4">
          <StoreQuickActions store={store} />
          <StoreHelpCard />
        </div>
      </div>

      {ready ? <StoreNextSteps adminUrl={store.adminUrl} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Plan &amp; usage</CardTitle>
              <CardDescription>What your plan allows, and what your store is using.</CardDescription>
            </div>
            <Button asChild variant="link" size="sm">
              <Link href="/dashboard/plans">Change</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoList>
              <InfoRow label="Current plan" value={plan?.name ?? '—'} />
              {trial && trial.status === 'active' ? (
                <InfoRow
                  label="Trial days left"
                  value={<span className="text-warning">{trial.daysRemaining} days</span>}
                />
              ) : null}
              <InfoRow
                label="Billing cycle"
                value={subscription?.billingCycle === 'yearly' ? 'Yearly' : 'Monthly'}
              />
            </InfoList>

            <div className="space-y-3 border-t border-border pt-4">
              <UsageRow
                icon={Package}
                label="Products limit"
                used={usage?.products ?? null}
                limit={usage?.limits?.products ?? plan?.productLimit ?? null}
                display={
                  usage?.products === null || usage?.products === undefined
                    ? formatLimit(plan?.productLimit ?? null)
                    : `${usage.products.toLocaleString('en-US')} / ${formatLimit(usage.limits?.products ?? plan?.productLimit ?? null)}`
                }
              />
              <UsageRow
                icon={Users}
                label="Admin users"
                used={usage?.admins ?? null}
                limit={usage?.limits?.admins ?? plan?.adminLimit ?? null}
                display={
                  usage?.admins === null || usage?.admins === undefined
                    ? formatLimit(plan?.adminLimit ?? null)
                    : `${usage.admins} / ${formatLimit(usage.limits?.admins ?? plan?.adminLimit ?? null)}`
                }
              />
              <UsageRow
                icon={Cloud}
                label="Storage allowance"
                used={usage?.storageBytes === null || usage?.storageBytes === undefined ? null : usage.storageBytes / 1024 / 1024}
                limit={usage?.limits?.storageMb ?? plan?.storageLimitMb ?? null}
                display={
                  usage?.storageBytes === null || usage?.storageBytes === undefined
                    ? formatStorage(plan?.storageLimitMb ?? null)
                    : `${formatBytes(usage.storageBytes)} / ${formatStorage(usage.limits?.storageMb ?? plan?.storageLimitMb ?? null)}`
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admin panel login</CardTitle>
            <CardDescription>The only login that opens your store admin panel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <InfoList>
              <InfoRow icon={KeyRound} label="Sign-in email" value={adminEmail ?? '—'} />
            </InfoList>

            <p className="text-xs text-muted-foreground">
              This login is separate from the account you use on this site — changing your password here does
              not change it, and changing it does not change this one.
            </p>

            {adminEmail ? (
              <div className="border-t border-border pt-5">
                <AdminPasswordReset adminEmail={adminEmail} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
