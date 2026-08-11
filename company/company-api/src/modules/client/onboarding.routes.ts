import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  clientAccounts,
  clientBusinessProfiles,
  domains,
  payments,
  plans,
  subscriptions,
  tenants,
  trials,
} from '../../db/schema/index';
import { AppError, ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { ok, parseBody } from '../../lib/http';
import { publicId, generateToken } from '../../lib/crypto';
import { hashPassword } from '../../lib/password';
import { tenantDatabaseName, toMoney, validateCustomDomain, validateSubdomain } from '../../lib/utils';
import { dnsInstructions } from '../../lib/dns';
import { config } from '../../config/index';
import { RATE_LIMITS } from '../../lib/constants';
import { isOtpExpired } from '../../lib/otp';
import { enforce } from '../../lib/rate-limit';
import {
  defaultPaymentMethodView,
  getActivePlanOrThrow,
  priceFor,
  startCheckout,
  startPaymentMethodSetup,
} from '../../services/billing';
import { runProvisioning } from '../../services/provisioning';
import {
  assertResendAllowed,
  consumeStoreAdminOtp,
  issueStoreAdminOtp,
} from '../../services/store-admin';
import { emails } from '../../lib/mailer';
import { domainView, storeView } from '../../services/views';
import { isPlaceholderSlug, placeholderSlug, resolveOnboardingStep } from '../../services/onboarding';
import { queueProvisioning } from '../../queues/index';

/**
 * A plan and a billing cycle — nothing else. Whether this is a trial is a
 * property of the plan chosen, never a flag the caller sends: the trial is its
 * own plan now, so "which plan" and "is this a trial" cannot disagree.
 */
const planSchema = z.object({
  planId: z.string().uuid('Choose a plan to continue.'),
  billingCycle: z.enum(['monthly', 'yearly']),
});

/**
 * What the store is called and where customers reach it. Currency, language,
 * timezone and template are deliberately absent — those are store settings, and
 * the owner sets them inside their own admin panel.
 */
const websiteSetupSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name.').max(160),
  slug: z.string().trim().toLowerCase().min(3).max(40),
  storefrontDomain: z.string().trim().max(253).optional().or(z.literal('')),
});

/** The store admin panel's own login, and optionally its own address. */
const adminPanelSetupSchema = z.object({
  adminEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  adminPassword: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'Password is too long.')
    .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
    .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
    .refine((v) => /\d/.test(v), 'Include at least one number.')
    .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.'),
  adminDomain: z.string().trim().max(253).optional().or(z.literal('')),
});

const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');

async function loadState(accountId: string) {
  const [accountRows, profileRows, tenantRows] = await Promise.all([
    db.select().from(clientAccounts).where(eq(clientAccounts.id, accountId)).limit(1),
    db.select().from(clientBusinessProfiles).where(eq(clientBusinessProfiles.clientAccountId, accountId)).limit(1),
    db.select().from(tenants).where(eq(tenants.clientAccountId, accountId)).limit(1),
  ]);

  const account = accountRows[0];
  const tenant = tenantRows[0];

  const [subscriptionRows, trialRows, paidRows, domainRows] = await Promise.all([
    tenant
      ? db
          .select({ subscription: subscriptions, plan: plans })
          .from(subscriptions)
          .leftJoin(plans, eq(plans.id, subscriptions.planId))
          .where(eq(subscriptions.tenantId, tenant.id))
          .limit(1)
      : [],
    tenant ? db.select().from(trials).where(eq(trials.tenantId, tenant.id)).limit(1) : [],
    tenant
      ? db
          .select({ id: payments.id })
          .from(payments)
          .where(and(eq(payments.tenantId, tenant.id), eq(payments.status, 'paid')))
          .limit(1)
      : [],
    tenant ? db.select().from(domains).where(eq(domains.tenantId, tenant.id)) : [],
  ]);

  return {
    account,
    profile: profileRows[0],
    tenant,
    subscription: subscriptionRows[0]?.subscription,
    plan: subscriptionRows[0]?.plan ?? undefined,
    trial: trialRows[0],
    hasSettledPayment: Boolean(paidRows[0]),
    domains: domainRows,
  };
}

type State = Awaited<ReturnType<typeof loadState>>;

/**
 * The free trial is a plan, and it is offered once per account for life.
 *
 * Two things end the offer for good, and both have to be checked here because
 * the frontend only hides the card: starting the trial, stamped on the account
 * so the record outlives the tenant, the subscription and the trial row (all
 * three can be replaced) — and buying anything, because a trial is for someone
 * who has not decided yet. Re-choosing the trial already in progress is not a
 * second trial, so that one case stays open; otherwise reloading the billing
 * page would lock someone out of the plan they are halfway through paying for.
 */
async function trialOffer(state: State) {
  const [planRows, purchases] = await Promise.all([
    db
      .select()
      .from(plans)
      .where(and(eq(plans.isTrial, true), eq(plans.status, 'active')))
      .limit(1),
    state.account
      ? db
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.clientAccountId, state.account.id),
              eq(payments.status, 'paid'),
              eq(payments.purpose, 'subscription'),
            ),
          )
          .limit(1)
      : [],
  ]);

  const plan = planRows[0];
  const used = Boolean(state.account?.trialUsedAt);
  const purchased = Boolean(purchases[0]);
  const alreadyOnIt = Boolean(plan && state.subscription?.planId === plan.id);

  return {
    plan: plan ?? null,
    used,
    available: Boolean(plan) && (alreadyOnIt || (!used && !purchased)),
  };
}

/** A store exists once it has been given a real address and an admin login. */
function storeConfigured(tenant: State['tenant']): boolean {
  if (!tenant) return false;
  if (isPlaceholderSlug(tenant.slug)) return false;
  return Boolean(tenant.storeAdminEmail) || tenant.storeStatus !== 'not_created';
}

/**
 * Every plan is billed, and nothing is set up before that bill is paid. What
 * changes between a purchase, a trial and a free plan is the *amount*, never the
 * process: a trial and a free plan are billed 0.00 and still have to go through
 * the gateway, so a card is on file and the subscription can bill itself later.
 *
 * `amount` is what is due today; `planPrice` is what the plan costs once the
 * trial converts, which is the difference the bill has to show.
 */
function paymentRequirement(state: State) {
  if (!state.subscription) return { required: false, amount: '0.00', planPrice: '0.00' };
  const planPrice = toMoney(state.subscription.price);
  const onTrial = state.trial?.status === 'active';
  return { required: true, amount: onTrial ? '0.00' : planPrice, planPrice };
}

function stepFor(state: State) {
  const requirement = paymentRequirement(state);
  return resolveOnboardingStep({
    hasSubscription: Boolean(state.subscription),
    paymentSettled: !requirement.required || state.hasSettledPayment,
    storeConfigured: storeConfigured(state.tenant),
  });
}

/**
 * Both setup halves share these gates: a plan, a settled payment, and a store
 * that has not already been built. Returns the tenant and plan so the caller
 * does not look them up twice.
 */
function assertReadyForSetup(state: State) {
  if (!state.account) throw notFound('Account not found.');
  if (!state.tenant || !state.subscription) {
    throw new AppError(ERROR_CODES.ONBOARDING_STEP_BLOCKED, 'Choose a plan first.', 409);
  }
  if (state.tenant.storeStatus === 'ready') {
    throw conflict('Your store has already been created.', ERROR_CODES.ONBOARDING_ALREADY_COMPLETE);
  }

  const requirement = paymentRequirement(state);
  if (requirement.required && !state.hasSettledPayment) {
    throw new AppError(ERROR_CODES.ONBOARDING_STEP_BLOCKED, 'Complete your payment first.', 409);
  }

  return { account: state.account, tenant: state.tenant, plan: state.plan };
}

/** Business name doubles as the store name; the rest of the invoice details are optional. */
async function upsertBusinessName(state: State, businessName: string): Promise<string | null> {
  if (state.profile) {
    await db
      .update(clientBusinessProfiles)
      .set({ businessName, updatedAt: new Date() })
      .where(eq(clientBusinessProfiles.id, state.profile.id));
    return state.profile.id;
  }

  const inserted = await db
    .insert(clientBusinessProfiles)
    .values({
      clientAccountId: state.account!.id,
      businessName,
      ownerName: state.account!.fullName,
      businessEmail: state.account!.email,
      businessPhone: state.account!.phone,
    })
    .returning({ id: clientBusinessProfiles.id });

  return inserted[0]?.id ?? null;
}

/** Validates a requested custom domain against the plan, its shape and its owner. */
async function resolveCustomDomain(input: {
  value: string | undefined;
  domainType: 'storefront_custom' | 'admin_custom';
  field: string;
  allowed: boolean;
  tenantId: string;
}): Promise<{ domain: string; domainType: 'storefront_custom' | 'admin_custom' } | null> {
  const value = input.value?.trim() ?? '';
  if (!value) return null;

  if (!input.allowed) {
    throw new AppError(
      ERROR_CODES.CUSTOM_DOMAIN_NOT_IN_PLAN,
      'Your plan does not include custom domains. Use a platform address, or upgrade your plan.',
      403,
      { details: { [input.field]: ['Your plan does not include custom domains.'] } },
    );
  }

  const check = validateCustomDomain(value, config.urls.platformRootDomain);
  if (!check.ok) {
    throw new AppError(
      check.reason === 'blocked' ? ERROR_CODES.DOMAIN_BLOCKED : ERROR_CODES.DOMAIN_INVALID,
      check.message,
      422,
      { details: { [input.field]: [check.message] } },
    );
  }

  const claimed = await db
    .select({ tenantId: domains.tenantId })
    .from(domains)
    .where(eq(domains.domain, check.value))
    .limit(1);

  if (claimed[0] && claimed[0].tenantId !== input.tenantId) {
    throw new AppError(ERROR_CODES.DOMAIN_TAKEN, 'That domain is already connected to a store.', 409, {
      details: { [input.field]: ['That domain is already connected to a store.'] },
    });
  }

  return { domain: check.value, domainType: input.domainType };
}

/** One row per domain type, always re-issued unverified — DNS must prove it again. */
async function writeCustomDomain(
  tenantId: string,
  entry: { domain: string; domainType: 'storefront_custom' | 'admin_custom' },
): Promise<void> {
  const existing = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.tenantId, tenantId), eq(domains.domainType, entry.domainType)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(domains)
      .set({
        domain: entry.domain,
        verified: false,
        status: 'pending',
        verificationToken: generateToken(16),
        verifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, existing[0].id));
    return;
  }

  await db.insert(domains).values({
    tenantId,
    domain: entry.domain,
    domainType: entry.domainType,
    verificationToken: generateToken(16),
    status: 'pending',
  });
}

/**
 * Provisioning needs an address to build the database and cookie domain from,
 * and a **verified** login to put inside it. The passcode is the last of the
 * three to arrive, so confirming it is what starts the build; saving either
 * setup step alone changes nothing but the draft.
 */
async function provisionIfComplete(tenantId: string, accountId: string): Promise<boolean> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = rows[0];
  if (!tenant) return false;
  if (isPlaceholderSlug(tenant.slug) || !tenant.storeAdminEmail) return false;
  if (!tenant.storeAdminEmailVerifiedAt) return false;
  if (tenant.storeStatus === 'creating' || tenant.storeStatus === 'ready') return false;

  await db
    .update(clientAccounts)
    .set({ onboardingStep: 'done', onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(clientAccounts.id, accountId));

  // Queue first, run inline if Redis is down.
  const queued = await queueProvisioning(tenantId);
  if (!queued) await runProvisioning(tenantId);
  return true;
}

async function setupResult(tenantId: string, provisioning: boolean) {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const domainRows = await db.select().from(domains).where(eq(domains.tenantId, tenantId));

  return {
    provisioning,
    store: isPlaceholderSlug(rows[0]!.slug) ? null : await storeView(rows[0]!),
    domains: domainRows
      .filter((row) => row.domainType !== 'platform_subdomain')
      .map((row) => domainView(row, row.verificationToken ? dnsInstructions(row.domain, row.verificationToken) : [])),
  };
}

export default async function onboardingRoutes(app: FastifyInstance) {
  app.get('/onboarding', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    const accountId = request.clientAuth!.accountId;
    const state = await loadState(accountId);
    if (!state.account) throw notFound('Account not found.');

    const requirement = paymentRequirement(state);
    const step = stepFor(state);

    // Before a subscription exists, fall back to the plan the visitor clicked on
    // the pricing page — it was captured at registration and would otherwise be
    // dead data, forcing them to pick their plan a second time.
    let plan: { planId: string; billingCycle: string; startTrial: boolean } | null = null;

    if (state.subscription) {
      plan = {
        planId: state.subscription.planId,
        billingCycle: state.subscription.billingCycle,
        startTrial: state.trial?.status === 'active',
      };
    } else if (state.account.intendedPlanCode) {
      const intended = await db
        .select({ id: plans.id, isTrial: plans.isTrial })
        .from(plans)
        .where(and(eq(plans.code, state.account.intendedPlanCode), eq(plans.status, 'active')))
        .limit(1);

      if (intended[0]) {
        plan = {
          planId: intended[0].id,
          billingCycle: state.account.intendedBillingCycle === 'yearly' ? 'yearly' : 'monthly',
          startTrial: intended[0].isTrial,
        };
      }
    }

    const trial = await trialOffer(state);

    // A pricing-page link to the trial is dead for an account that has already
    // had one: prefilling it would put a plan on the page the API is bound to
    // refuse. Falling back to no selection lands them on the plan grid instead.
    if (plan && !state.subscription && trial.plan?.id === plan.planId && !trial.available) {
      plan = null;
    }

    const selectedPlan = plan
      ? (await db.select().from(plans).where(eq(plans.id, plan.planId)).limit(1))[0]
      : undefined;

    return ok(reply, {
      step,
      completed: step === 'done',
      plan,
      planFeatures: selectedPlan
        ? {
            name: selectedPlan.name,
            customDomainEnabled: selectedPlan.customDomainEnabled,
            customAdminDomainEnabled: selectedPlan.customAdminDomainEnabled,
          }
        : null,
      payment: {
        required: requirement.required,
        settled: !requirement.required || state.hasSettledPayment,
        amount: requirement.amount,
        planPrice: requirement.planPrice,
        currency: config.payment.currency,
        mode: state.trial?.status === 'active' ? 'method_setup' : 'charge',
        method: await defaultPaymentMethodView(accountId),
      },
      // Whether the trial plan may still be chosen. The billing page hides the
      // card on `available: false`; the plan step refuses it either way.
      trialOffer: { available: trial.available, used: trial.used },
      store:
        state.tenant && storeConfigured(state.tenant)
          ? {
              businessName: state.profile?.businessName ?? state.tenant.storeName,
              slug: state.tenant.slug,
              adminEmail: state.tenant.storeAdminEmail,
            }
          : { businessName: state.profile?.businessName ?? '', slug: '', adminEmail: state.account.email },
      // The two setup halves, reported independently: each has its own page, and
      // either order is allowed. Provisioning starts when both are done.
      website: {
        configured: Boolean(state.tenant && !isPlaceholderSlug(state.tenant.slug)),
        businessName: state.profile?.businessName ?? '',
        slug: state.tenant && !isPlaceholderSlug(state.tenant.slug) ? state.tenant.slug : '',
        customDomain: state.domains.find((row) => row.domainType === 'storefront_custom')?.domain ?? null,
      },
      adminPanel: {
        configured: Boolean(state.tenant?.storeAdminEmail),
        adminEmail: state.tenant?.storeAdminEmail ?? state.account.email,
        customDomain: state.domains.find((row) => row.domainType === 'admin_custom')?.domain ?? null,
        verified: Boolean(state.tenant?.storeAdminEmailVerifiedAt),
        // Reported so a reload lands back on the passcode step rather than
        // making someone retype a password they have already chosen.
        pendingVerification:
          state.tenant &&
          state.tenant.storeAdminOtpPurpose === 'admin_panel_setup' &&
          state.tenant.storeAdminOtpHash &&
          !isOtpExpired(state.tenant.storeAdminOtpExpiresAt)
            ? {
                sentTo: state.tenant.storeAdminEmail,
                expiresAt: state.tenant.storeAdminOtpExpiresAt!.toISOString(),
              }
            : null,
      },
      store_view: state.tenant && !isPlaceholderSlug(state.tenant.slug) ? await storeView(state.tenant) : null,
    });
  });

  /**
   * Step 1 — plan. This is where the tenant row is born, because the
   * subscription, trial and payment that follow all hang off it. It carries a
   * placeholder address until the final step; nothing is provisioned from it.
   */
  app.post('/onboarding/plan', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    const body = parseBody(planSchema, request.body);
    const accountId = request.clientAuth!.accountId;

    const state = await loadState(accountId);
    if (!state.account) throw notFound('Account not found.');
    if (state.tenant && state.tenant.storeStatus === 'ready') {
      throw conflict('Your store has already been created.', ERROR_CODES.ONBOARDING_ALREADY_COMPLETE);
    }

    const plan = await getActivePlanOrThrow(body.planId);
    const price = priceFor(plan, body.billingCycle);

    // The trial is a plan like any other here — except that it can only be
    // taken once, and the frontend merely hides the card. This is the gate.
    if (plan.isTrial) {
      const offer = await trialOffer(state);
      if (!offer.available) {
        throw new AppError(
          ERROR_CODES.TRIAL_ALREADY_USED,
          'The free trial is available once per account, and this one has already used it. Choose a plan to continue.',
          409,
        );
      }
    }

    let tenant = state.tenant;
    if (!tenant) {
      const tenantRef = publicId('TNT');
      const inserted = await db
        .insert(tenants)
        .values({
          tenantRef,
          clientAccountId: accountId,
          storeName: `${state.account.fullName}'s store`.slice(0, 120),
          slug: placeholderSlug(tenantRef),
        })
        .returning();
      tenant = inserted[0]!;
    }

    if (state.subscription) {
      await db
        .update(subscriptions)
        .set({
          planId: plan.id,
          billingCycle: body.billingCycle,
          price,
          currency: config.payment.currency,
          status: plan.isTrial ? 'trial' : 'expired',
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, state.subscription.id));
    } else {
      await db.insert(subscriptions).values({
        tenantId: tenant.id,
        planId: plan.id,
        billingCycle: body.billingCycle,
        price,
        currency: config.payment.currency,
        status: plan.isTrial ? 'trial' : 'expired',
      });
    }

    // The trial row is created now but its clock only starts once provisioning
    // succeeds, so a failed setup never eats trial days. Switching away from
    // the trial plan cancels it — and the account keeps its used-once stamp,
    // because the offer is spent the moment it is taken.
    if (plan.isTrial && !state.trial) {
      await db.insert(trials).values({ tenantId: tenant.id, planId: plan.id, status: 'active' });
    } else if (state.trial) {
      await db
        .update(trials)
        .set({ planId: plan.id, status: plan.isTrial ? 'active' : 'cancelled', updatedAt: new Date() })
        .where(eq(trials.id, state.trial.id));
    }

    // Always payment, even at 0.00 — the bill is the gate, not its amount.
    await db
      .update(clientAccounts)
      .set({
        onboardingStep: 'payment',
        ...(plan.isTrial && !state.account.trialUsedAt ? { trialUsedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clientAccounts.id, accountId));

    return ok(reply, { step: 'payment' as const, amountDue: price, planPrice: price });
  });

  /**
   * Step 2 — paying the bill. A purchase is charged now; a trial completes a
   * zero-amount authorisation instead, so a card is on file before the store is
   * built. A free plan is a 0.00 charge — it still goes through the gateway,
   * because "the bill was paid" is the one fact everything downstream reads, and
   * a plan that quietly skipped it would leave that fact untrue.
   *
   * Either way the checkout URL proves nothing: only the signed webhook settles
   * it, so the frontend polls this state rather than trusting the redirect.
   */
  app.post('/onboarding/payment', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    await enforce(request, 'onboarding-payment', RATE_LIMITS.checkout);
    const accountId = request.clientAuth!.accountId;

    const state = await loadState(accountId);
    if (!state.account) throw notFound('Account not found.');
    if (!state.tenant || !state.subscription) {
      throw new AppError(ERROR_CODES.ONBOARDING_STEP_BLOCKED, 'Choose a plan first.', 409);
    }

    const requirement = paymentRequirement(state);
    if (!requirement.required || state.hasSettledPayment) {
      return ok(reply, { settled: true, checkoutUrl: null });
    }

    const planRows = await db.select().from(plans).where(eq(plans.id, state.subscription.planId)).limit(1);
    const planName = planRows[0]?.name ?? 'Subscription';
    const usingTrial = state.trial?.status === 'active';

    // Straight back to the billing page rather than through /onboarding's
    // permanent redirect, which would lose the query string on some clients.
    const successUrl = `${config.urls.website}/dashboard/plans?payment=success`;
    const cancelUrl = `${config.urls.website}/dashboard/plans?payment=cancelled`;

    const session = usingTrial
      ? await startPaymentMethodSetup({
          tenantId: state.tenant.id,
          clientAccountId: accountId,
          planId: state.subscription.planId,
          billingCycle: state.subscription.billingCycle,
          customerEmail: state.account.email,
          description: `Card authorisation — ${planName} trial`,
          successUrl,
          cancelUrl,
        })
      : await startCheckout({
          tenantId: state.tenant.id,
          clientAccountId: accountId,
          planId: state.subscription.planId,
          billingCycle: state.subscription.billingCycle,
          customerEmail: state.account.email,
          description: `${planName} subscription`,
          successUrl,
          cancelUrl,
        });

    return ok(reply, { settled: false, checkoutUrl: session.checkoutUrl });
  });

  /**
   * Website setup — what customers see. Saved on its own so it can be done
   * before or after the admin panel; provisioning waits until both halves exist.
   *
   * The address is fixed here and cannot move afterwards: the tenant database
   * name and the store's cookie domain are both derived from it.
   */
  app.post('/onboarding/website', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    const body = parseBody(websiteSetupSchema, request.body);
    const accountId = request.clientAuth!.accountId;

    const state = await loadState(accountId);
    const { tenant, plan } = assertReadyForSetup(state);

    // The frontend availability check is convenience only; this is the real gate.
    const slugCheck = validateSubdomain(body.slug);
    if (!slugCheck.ok) {
      throw new AppError(
        slugCheck.reason === 'reserved' ? ERROR_CODES.SUBDOMAIN_RESERVED : ERROR_CODES.SUBDOMAIN_INVALID,
        slugCheck.message,
        422,
        { details: { slug: [slugCheck.message] } },
      );
    }
    if (isPlaceholderSlug(slugCheck.value)) {
      throw new AppError(ERROR_CODES.SUBDOMAIN_RESERVED, 'This name is reserved by the platform.', 422, {
        details: { slug: ['This name is reserved by the platform.'] },
      });
    }

    const taken = await db
      .select({ clientAccountId: tenants.clientAccountId })
      .from(tenants)
      .where(eq(tenants.slug, slugCheck.value))
      .limit(1);

    if (taken[0] && taken[0].clientAccountId !== accountId) {
      throw new AppError(ERROR_CODES.SUBDOMAIN_TAKEN, 'This address is already taken.', 409, {
        details: { slug: ['This address is already taken.'] },
      });
    }

    // Resolved before anything is written, so a rejected domain never leaves a
    // half-configured store behind.
    const customDomain = await resolveCustomDomain({
      value: body.storefrontDomain,
      domainType: 'storefront_custom',
      field: 'storefrontDomain',
      allowed: plan?.customDomainEnabled ?? false,
      tenantId: tenant.id,
    });

    const profileId = await upsertBusinessName(state, body.businessName);

    await db
      .update(tenants)
      .set({
        storeName: body.businessName.slice(0, 120),
        slug: slugCheck.value,
        businessProfileId: profileId,
        databaseName: tenantDatabaseName(slugCheck.value, config.tenantDb.namePrefix),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id));

    if (customDomain) await writeCustomDomain(tenant.id, customDomain);

    const provisioning = await provisionIfComplete(tenant.id, accountId);
    return ok(reply, await setupResult(tenant.id, provisioning));
  });

  /**
   * Admin panel setup — the login for the store's own admin panel, and
   * optionally the address it answers on. This login is deliberately separate
   * from the SaaS account: changing one never changes the other.
   *
   * Nothing is built from here. The chosen login is staged and a passcode goes
   * to it, because this address is the *only* way into the panel once the store
   * exists — a mistyped one would be discovered by an owner who is already
   * locked out. `/verify` below is what starts provisioning.
   */
  app.post('/onboarding/admin-panel', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    await enforce(request, 'store-admin-otp', RATE_LIMITS.storeAdminOtp);

    const body = parseBody(adminPanelSetupSchema, request.body);
    const accountId = request.clientAuth!.accountId;

    const state = await loadState(accountId);
    const { tenant, plan } = assertReadyForSetup(state);

    const customDomain = await resolveCustomDomain({
      value: body.adminDomain,
      domainType: 'admin_custom',
      field: 'adminDomain',
      allowed: plan?.customAdminDomainEnabled ?? false,
      tenantId: tenant.id,
    });

    // Re-submitting the same address inside the cooldown is a resend, and is
    // refused as one — otherwise the form is a way to mail somebody repeatedly.
    if (tenant.storeAdminEmail === body.adminEmail) assertResendAllowed(tenant, 'admin_panel_setup');

    // Hashed here so the plaintext never reaches provisioning, the queue or the
    // tenant database — the same Argon2id parameters the client API verifies with.
    const storeAdminPasswordHash = await hashPassword(body.adminPassword);

    await db
      .update(tenants)
      .set({
        storeAdminEmail: body.adminEmail,
        storeAdminPasswordHash,
        // A different address has not been proven by the code sent to the old
        // one, and re-submitting the same one restarts the proof either way.
        storeAdminEmailVerifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id));

    if (customDomain) await writeCustomDomain(tenant.id, customDomain);

    const challenge = await issueStoreAdminOtp(tenant.id, 'admin_panel_setup', body.adminEmail);
    await emails.storeAdminSetupCode(body.adminEmail, challenge.code, config.security.otpTtlMinutes, {
      clientAccountId: accountId,
      tenantId: tenant.id,
    });

    return ok(reply, {
      otpRequired: true as const,
      sentTo: challenge.sentTo,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  });

  /** A fresh passcode for the address already staged, on the same cooldown. */
  app.post('/onboarding/admin-panel/resend', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    await enforce(request, 'store-admin-otp-resend', RATE_LIMITS.storeAdminOtpResend);

    const accountId = request.clientAuth!.accountId;
    const state = await loadState(accountId);
    const { tenant } = assertReadyForSetup(state);

    if (!tenant.storeAdminEmail) {
      throw new AppError(ERROR_CODES.ONBOARDING_STEP_BLOCKED, 'Choose your admin panel login first.', 409);
    }

    assertResendAllowed(tenant, 'admin_panel_setup');

    const challenge = await issueStoreAdminOtp(tenant.id, 'admin_panel_setup', tenant.storeAdminEmail);
    await emails.storeAdminSetupCode(tenant.storeAdminEmail, challenge.code, config.security.otpTtlMinutes, {
      clientAccountId: accountId,
      tenantId: tenant.id,
    });

    return ok(reply, { sentTo: challenge.sentTo, expiresAt: challenge.expiresAt.toISOString() });
  });

  /**
   * The last step of setup. The passcode proves the login can be read, and the
   * store — database, schema, admin, subdomain — is built from here.
   */
  app.post('/onboarding/admin-panel/verify', { preHandler: app.requireVerifiedClient }, async (request, reply) => {
    await enforce(request, 'store-admin-otp-verify', RATE_LIMITS.storeAdminOtpVerify);

    const { code } = parseBody(z.object({ code: otpCodeSchema }), request.body);
    const accountId = request.clientAuth!.accountId;

    const state = await loadState(accountId);
    const { tenant } = assertReadyForSetup(state);

    await consumeStoreAdminOtp(tenant.id, 'admin_panel_setup', code);

    const provisioning = await provisionIfComplete(tenant.id, accountId);
    return ok(reply, await setupResult(tenant.id, provisioning));
  });
}
