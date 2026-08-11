import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { domains, provisioningJobs, plans, subscriptions, trials } from '../db/schema/index';
import { config } from '../config/index';
import { PROVISIONING_STEP_LABELS, type ProvisioningStepName } from '../lib/constants';
import { buildClientAdminUrl, buildStorefrontUrl, daysRemaining, platformSubdomain } from '../lib/utils';
import { provisioningStepsView } from './provisioning';

type PlanRow = typeof plans.$inferSelect;
type TenantRow = {
  id: string;
  tenantRef: string;
  storeName: string;
  slug: string;
  currency: string;
  language: string;
  timezone: string;
  status: string;
  storeStatus: string;
  createdAt: Date;
};

/** Public shape of a plan. `status` is intentionally omitted for public callers. */
export function planPublicView(plan: PlanRow) {
  return {
    id: plan.id,
    name: plan.name,
    code: plan.code,
    description: plan.description,
    monthlyPrice: plan.monthlyPrice,
    yearlyPrice: plan.yearlyPrice,
    productLimit: plan.productLimit,
    adminLimit: plan.adminLimit,
    storageLimitMb: plan.storageLimitMb,
    customDomainEnabled: plan.customDomainEnabled,
    customAdminDomainEnabled: plan.customAdminDomainEnabled,
    analyticsEnabled: plan.analyticsEnabled,
    reportsEnabled: plan.reportsEnabled,
    supportLevel: plan.supportLevel,
    isFeatured: plan.isFeatured,
    isTrial: plan.isTrial,
    sortOrder: plan.sortOrder,
  };
}

export function planAdminView(plan: PlanRow, subscriberCount = 0) {
  return { ...planPublicView(plan), status: plan.status, subscriberCount };
}

/**
 * The address that actually opens a client's store admin panel — a different
 * login from the website one, and deliberately independent of it. Setup chooses
 * it and confirms it by passcode; tenants provisioned before that step existed
 * were built with the SaaS account credential, which is still what opens their
 * panel. A store that does not exist yet has no panel and so no login.
 */
export function storeAdminLogin(row: {
  storeAdminEmail: string | null;
  storeStatus: string | null;
  email: string;
}): string | null {
  if (row.storeAdminEmail) return row.storeAdminEmail;
  return row.storeStatus === 'ready' ? row.email : null;
}

/**
 * Store view for the client account area. Database name, host and credentials
 * are deliberately absent — they must never leave the server.
 */
export async function storeView(tenant: TenantRow) {
  const [customDomainRows, jobRows] = await Promise.all([
    db.select().from(domains).where(eq(domains.tenantId, tenant.id)),
    db.select().from(provisioningJobs).where(eq(provisioningJobs.tenantId, tenant.id)).limit(1),
  ]);

  const custom = customDomainRows.find(
    (row) => row.domainType === 'storefront_custom' && row.status === 'active' && row.verified,
  );
  const job = jobRows[0];

  return {
    tenantId: tenant.tenantRef,
    storeName: tenant.storeName,
    slug: tenant.slug,
    status: tenant.status,
    storeStatus: tenant.storeStatus,
    provisioningStatus: job?.status ?? null,
    provisioningSteps: provisioningStepsView(job?.completedSteps).map((entry) => ({
      step: entry.step,
      label: PROVISIONING_STEP_LABELS[entry.step as ProvisioningStepName],
      done: entry.done,
    })),
    storefrontUrl: buildStorefrontUrl(tenant.slug, config.urls.platformRootDomain, custom?.domain ?? null),
    adminUrl: buildClientAdminUrl(tenant.slug, config.urls.clientAdminPattern),
    platformSubdomain: platformSubdomain(tenant.slug, config.urls.platformRootDomain),
    customDomain: custom?.domain ?? null,
    currency: tenant.currency,
    language: tenant.language,
    timezone: tenant.timezone,
    createdAt: tenant.createdAt,
  };
}

export async function trialView(tenantId: string) {
  const rows = await db.select().from(trials).where(eq(trials.tenantId, tenantId)).limit(1);
  const trial = rows[0];
  if (!trial) return null;

  return {
    status: trial.status,
    startedAt: trial.startedAt,
    endsAt: trial.endsAt,
    daysRemaining: trial.status === 'active' ? daysRemaining(trial.endsAt) : 0,
  };
}

export async function subscriptionView(tenantId: string) {
  const rows = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  const trial = await trialView(tenantId);
  const row = rows[0];

  if (!row) {
    return {
      id: null,
      status: trial?.status === 'active' ? 'trial' : 'expired',
      plan: null,
      billingCycle: null,
      price: null,
      startedAt: null,
      renewalAt: null,
      cancelledAt: null,
      trial,
    };
  }

  return {
    id: row.subscription.id,
    status: row.subscription.status,
    plan: row.plan ? planPublicView(row.plan) : null,
    billingCycle: row.subscription.billingCycle,
    price: row.subscription.price,
    startedAt: row.subscription.startedAt,
    renewalAt: row.subscription.renewalAt,
    cancelledAt: row.subscription.cancelledAt,
    trial,
  };
}

export function domainView(row: typeof domains.$inferSelect, instructions: unknown[] = []) {
  return {
    id: row.id,
    domain: row.domain,
    domainType: row.domainType,
    isPrimary: row.isPrimary,
    verified: row.verified,
    status: row.status,
    verificationToken: row.domainType === 'platform_subdomain' ? null : row.verificationToken,
    dnsInstructions: instructions,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
  };
}
