import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  activityEvents,
  clientAccounts,
  clientBusinessProfiles,
  domains,
  invoices,
  payments,
  plans,
  provisioningJobs,
  subscriptions,
  supportTickets,
  tenants,
  trials,
} from '../../db/schema/index';
import { config } from '../../config/index';
import { ERROR_CODES, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, paginationSchema, uuidParamSchema } from '../../lib/http';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { invalidateTenantCache } from '../../lib/tenant-cache';
import { PROVISIONING_STEP_LABELS, type ProvisioningStepName } from '../../lib/constants';
import { addDays, buildClientAdminUrl, buildStorefrontUrl, daysRemaining, platformSubdomain } from '../../lib/utils';
import { isPlaceholderSlug } from '../../services/onboarding';
import { provisioningStepsView } from '../../services/provisioning';
import { storeAdminLogin } from '../../services/views';
import { getActivePlanOrThrow, priceFor } from '../../services/billing';

/**
 * Maps the UI filter chips onto concrete conditions.
 *
 * The first two answer "is this a customer or only a visitor who registered?".
 * The plan step is what creates the subscription row, so an account with none is
 * one that signed in to the website and never took the service.
 */
function statusCondition(status: string | undefined) {
  switch (status) {
    case 'signup_only':
      return isNull(subscriptions.id);
    case 'customer':
      return inArray(subscriptions.status, ['trial', 'active']);
    case 'trial':
      return eq(subscriptions.status, 'trial');
    case 'active':
      return eq(clientAccounts.status, 'active');
    case 'paid':
      return eq(subscriptions.status, 'active');
    case 'expired':
      return eq(subscriptions.status, 'expired');
    case 'suspended':
      return eq(clientAccounts.status, 'suspended');
    case 'cancelled':
      return eq(subscriptions.status, 'cancelled');
    default:
      return undefined;
  }
}

export default async function adminClientRoutes(app: FastifyInstance) {
  app.get('/clients', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);

    const search = query.search?.trim();
    const searchCondition = search
      ? or(
          ilike(clientBusinessProfiles.businessName, `%${search}%`),
          ilike(clientAccounts.email, `%${search}%`),
          ilike(clientAccounts.fullName, `%${search}%`),
          ilike(clientAccounts.phone, `%${search}%`),
          ilike(tenants.tenantRef, `%${search}%`),
          ilike(tenants.slug, `%${search}%`),
          // The panel login is a separate address from the website one, so it
          // has to be searchable in its own right.
          ilike(tenants.storeAdminEmail, `%${search}%`),
        )
      : undefined;

    const conditions = [searchCondition, statusCondition(query.status)].filter(Boolean);
    const where = conditions.length > 0 ? and(...(conditions as NonNullable<typeof searchCondition>[])) : undefined;

    const base = db
      .select({
        id: clientAccounts.id,
        fullName: clientAccounts.fullName,
        email: clientAccounts.email,
        phone: clientAccounts.phone,
        accountStatus: clientAccounts.status,
        registeredAt: clientAccounts.createdAt,
        lastLoginAt: clientAccounts.lastLoginAt,
        businessName: clientBusinessProfiles.businessName,
        tenantRef: tenants.tenantRef,
        slug: tenants.slug,
        storeStatus: tenants.storeStatus,
        storeAdminEmail: tenants.storeAdminEmail,
        storeAdminEmailVerifiedAt: tenants.storeAdminEmailVerifiedAt,
        planName: plans.name,
        subscriptionStatus: subscriptions.status,
        renewalAt: subscriptions.renewalAt,
        amount: subscriptions.price,
        currency: subscriptions.currency,
        trialStatus: trials.status,
        trialEndsAt: trials.endsAt,
      })
      .from(clientAccounts)
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .leftJoin(tenants, eq(tenants.clientAccountId, clientAccounts.id))
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(trials, eq(trials.tenantId, tenants.id));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(clientAccounts.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalQuery = db
      .select({ total: count() })
      .from(clientAccounts)
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .leftJoin(tenants, eq(tenants.clientAccountId, clientAccounts.id))
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id));

    const totals = await (where ? totalQuery.where(where) : totalQuery);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantRef,
        businessName: row.businessName ?? row.fullName,
        ownerName: row.fullName,
        email: row.email,
        storeAdminEmail: storeAdminLogin(row),
        storeAdminEmailVerified: row.storeAdminEmailVerifiedAt !== null,
        phone: row.phone,
        registeredAt: row.registeredAt,
        trialStatus: row.trialStatus,
        trialEndsAt: row.trialEndsAt,
        planName: row.planName,
        subscriptionStatus: row.subscriptionStatus,
        renewalAt: row.renewalAt,
        amount: row.amount,
        currency: row.currency ?? config.payment.currency,
        storeStatus: row.storeStatus,
        // A tenant exists from the moment a plan is chosen and carries a
        // placeholder slug until signup names the store — that is not an address
        // and must not be shown as one.
        domain:
          row.slug && !isPlaceholderSlug(row.slug)
            ? platformSubdomain(row.slug, config.urls.platformRootDomain)
            : null,
        lastLoginAt: row.lastLoginAt,
        accountStatus: row.accountStatus,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.get('/clients/:id', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const accountRows = await db.select().from(clientAccounts).where(eq(clientAccounts.id, id)).limit(1);
    const account = accountRows[0];
    if (!account) throw notFound('Client not found.');

    const [profileRows, tenantRows] = await Promise.all([
      db.select().from(clientBusinessProfiles).where(eq(clientBusinessProfiles.clientAccountId, id)).limit(1),
      db.select().from(tenants).where(eq(tenants.clientAccountId, id)).limit(1),
    ]);

    const profile = profileRows[0];
    const tenant = tenantRows[0];
    const namedTenant = tenant && !isPlaceholderSlug(tenant.slug) ? tenant : undefined;

    const [subscriptionRows, trialRows, jobRows, domainRows, paymentRows, invoiceRows, ticketRows, activityRows] =
      await Promise.all([
        tenant
          ? db
              .select({ subscription: subscriptions, plan: plans })
              .from(subscriptions)
              .leftJoin(plans, eq(plans.id, subscriptions.planId))
              .where(eq(subscriptions.tenantId, tenant.id))
              .limit(1)
          : Promise.resolve([]),
        tenant ? db.select().from(trials).where(eq(trials.tenantId, tenant.id)).limit(1) : Promise.resolve([]),
        tenant
          ? db.select().from(provisioningJobs).where(eq(provisioningJobs.tenantId, tenant.id)).limit(1)
          : Promise.resolve([]),
        tenant ? db.select().from(domains).where(eq(domains.tenantId, tenant.id)) : Promise.resolve([]),
        tenant
          ? db
              .select({ payment: payments, planName: plans.name })
              .from(payments)
              .leftJoin(plans, eq(plans.id, payments.planId))
              .where(eq(payments.tenantId, tenant.id))
              .orderBy(desc(payments.createdAt))
              .limit(20)
          : Promise.resolve([]),
        tenant
          ? db
              .select({ invoice: invoices, planName: plans.name })
              .from(invoices)
              .leftJoin(plans, eq(plans.id, invoices.planId))
              .where(eq(invoices.tenantId, tenant.id))
              .orderBy(desc(invoices.issuedAt))
              .limit(20)
          : Promise.resolve([]),
        db
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.clientAccountId, id))
          .orderBy(desc(supportTickets.createdAt))
          .limit(20),
        db
          .select()
          .from(activityEvents)
          .where(eq(activityEvents.clientAccountId, id))
          .orderBy(desc(activityEvents.createdAt))
          .limit(20),
      ]);

    const subscription = subscriptionRows[0];
    const trial = trialRows[0];
    const job = jobRows[0];
    const businessName = profile?.businessName ?? account.fullName;
    const customDomain = domainRows.find((row) => row.domainType === 'storefront_custom' && row.verified);

    return ok(reply, {
      id: account.id,
      tenantId: tenant?.tenantRef ?? null,
      businessName,
      ownerName: account.fullName,
      email: account.email,
      storeAdminEmail: storeAdminLogin({
        storeAdminEmail: tenant?.storeAdminEmail ?? null,
        storeStatus: tenant?.storeStatus ?? null,
        email: account.email,
      }),
      storeAdminEmailVerified: tenant?.storeAdminEmailVerifiedAt != null,
      phone: account.phone,
      registeredAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
      accountStatus: account.status,
      emailVerified: account.emailVerified,

      country: profile?.country ?? null,
      address: profile?.address ?? null,
      businessType: profile?.businessType ?? null,
      businessEmail: profile?.businessEmail ?? null,
      businessPhone: profile?.businessPhone ?? null,

      tenantStatus: tenant?.status ?? null,
      storeStatus: tenant?.storeStatus ?? null,
      // A tenant that has only picked a plan carries a placeholder slug, so it
      // has no addresses yet — showing derived ones would invent them.
      storefrontUrl: namedTenant
        ? buildStorefrontUrl(namedTenant.slug, config.urls.platformRootDomain, customDomain?.domain ?? null)
        : null,
      adminUrl: namedTenant ? buildClientAdminUrl(namedTenant.slug, config.urls.clientAdminPattern) : null,
      platformSubdomain: namedTenant
        ? platformSubdomain(namedTenant.slug, config.urls.platformRootDomain)
        : null,
      customDomain: customDomain?.domain ?? null,
      currency: tenant?.currency ?? config.payment.currency,
      language: tenant?.language ?? null,
      timezone: tenant?.timezone ?? null,
      domain: namedTenant ? platformSubdomain(namedTenant.slug, config.urls.platformRootDomain) : null,

      planName: subscription?.plan?.name ?? null,
      subscriptionStatus: subscription?.subscription.status ?? null,
      renewalAt: subscription?.subscription.renewalAt ?? null,
      amount: subscription?.subscription.price ?? null,
      trialStatus: trial?.status ?? null,
      trialEndsAt: trial?.endsAt ?? null,

      provisioning: job
        ? {
            id: job.id,
            clientId: account.id,
            businessName,
            tenantId: tenant?.tenantRef ?? '',
            status: job.status,
            currentStep: job.currentStep,
            steps: provisioningStepsView(job.completedSteps).map((entry) => ({
              step: entry.step,
              label: PROVISIONING_STEP_LABELS[entry.step as ProvisioningStepName],
              done: entry.done,
            })),
            errorMessage: job.errorMessage,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            createdAt: job.createdAt,
          }
        : null,

      subscription: subscription
        ? {
            id: subscription.subscription.id,
            clientId: account.id,
            businessName,
            planName: subscription.plan?.name ?? null,
            billingCycle: subscription.subscription.billingCycle,
            price: subscription.subscription.price,
            currency: subscription.subscription.currency,
            startedAt: subscription.subscription.startedAt,
            renewalAt: subscription.subscription.renewalAt,
            cancelledAt: subscription.subscription.cancelledAt,
            status: subscription.subscription.status,
          }
        : null,

      trial: trial
        ? {
            status: trial.status,
            startedAt: trial.startedAt,
            endsAt: trial.endsAt,
            daysRemaining: trial.status === 'active' ? daysRemaining(trial.endsAt) : 0,
          }
        : null,

      payments: paymentRows.map((row) => ({
        id: row.payment.id,
        transactionId: row.payment.transactionId,
        clientId: account.id,
        businessName,
        planName: row.planName,
        amount: row.payment.amount,
        currency: row.payment.currency,
        provider: row.payment.provider,
        status: row.payment.status,
        createdAt: row.payment.createdAt,
        paidAt: row.payment.paidAt,
      })),

      invoices: invoiceRows.map((row) => ({
        id: row.invoice.id,
        invoiceNumber: row.invoice.invoiceNumber,
        clientId: account.id,
        businessName,
        planName: row.planName,
        amount: row.invoice.amount,
        currency: row.invoice.currency,
        status: row.invoice.status,
        issuedAt: row.invoice.issuedAt,
        paidAt: row.invoice.paidAt,
      })),

      domains: domainRows.map((row) => ({
        id: row.id,
        clientId: account.id,
        businessName,
        domain: row.domain,
        domainType: row.domainType,
        isPrimary: row.isPrimary,
        verified: row.verified,
        status: row.status,
        createdAt: row.createdAt,
        lastCheckedAt: row.lastCheckedAt,
      })),

      tickets: ticketRows.map((row) => ({
        id: row.id,
        reference: row.reference,
        clientId: account.id,
        businessName,
        subject: row.subject,
        status: row.status,
        priority: row.priority,
        createdAt: row.createdAt,
        lastReplyAt: row.lastReplyAt,
        messageCount: row.messageCount,
      })),

      activity: activityRows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        subject: row.subject,
        createdAt: row.createdAt,
      })),
    });
  });

  // --- Client actions ---------------------------------------------------------

  app.post('/clients/:id/suspend', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const now = new Date();

    const rows = await db
      .select({ status: clientAccounts.status, email: clientAccounts.email })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, id))
      .limit(1);
    if (!rows[0]) throw notFound('Client not found.');

    await db
      .update(clientAccounts)
      .set({ status: 'suspended', suspendedAt: now, updatedAt: now })
      .where(eq(clientAccounts.id, id));

    // The store goes offline, but no data is deleted and billing is untouched.
    const suspended = await db
      .update(tenants)
      .set({ status: 'suspended', storeStatus: 'suspended', suspendedAt: now, updatedAt: now })
      .where(eq(tenants.clientAccountId, id))
      .returning({ id: tenants.id });

    // A suspension that the client platform serves from cache for another minute
    // is not a suspension. This is the one invalidation that is security-facing.
    for (const tenant of suspended) await invalidateTenantCache(tenant.id);

    await recordAudit(request, {
      action: AUDIT_ACTIONS.CLIENT_SUSPENDED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      clientAccountId: id,
      targetLabel: rows[0].email,
      oldValue: rows[0].status,
      newValue: 'suspended',
    });

    return ok(reply, { suspended: true });
  });

  app.post('/clients/:id/reactivate', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const now = new Date();

    const rows = await db
      .select({ status: clientAccounts.status, email: clientAccounts.email })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, id))
      .limit(1);
    if (!rows[0]) throw notFound('Client not found.');

    await db
      .update(clientAccounts)
      .set({ status: 'active', suspendedAt: null, updatedAt: now })
      .where(eq(clientAccounts.id, id));

    const tenantRows = await db.select().from(tenants).where(eq(tenants.clientAccountId, id)).limit(1);
    if (tenantRows[0]) {
      const subscriptionRows = await db
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantRows[0].id))
        .limit(1);

      const nextStatus =
        subscriptionRows[0]?.status === 'active'
          ? 'active'
          : subscriptionRows[0]?.status === 'trial'
            ? 'trial'
            : 'expired';

      await db
        .update(tenants)
        .set({
          status: nextStatus,
          storeStatus: tenantRows[0].databaseName ? 'ready' : 'not_created',
          suspendedAt: null,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantRows[0].id));

      await invalidateTenantCache(tenantRows[0].id);
    }

    await recordAudit(request, {
      action: AUDIT_ACTIONS.CLIENT_REACTIVATED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      clientAccountId: id,
      targetLabel: rows[0].email,
      oldValue: rows[0].status,
      newValue: 'active',
    });

    return ok(reply, { reactivated: true });
  });

  app.post('/clients/:id/extend-trial', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const { days } = parseBody(z.object({ days: z.coerce.number().int().min(1).max(365) }), request.body);

    const tenantRows = await db.select().from(tenants).where(eq(tenants.clientAccountId, id)).limit(1);
    if (!tenantRows[0]) throw notFound('This client has no store yet.', ERROR_CODES.TENANT_NOT_FOUND);

    const trialRows = await db.select().from(trials).where(eq(trials.tenantId, tenantRows[0].id)).limit(1);
    const trial = trialRows[0];
    if (!trial) throw notFound('This client has no trial.', ERROR_CODES.TRIAL_NOT_FOUND);

    const base = trial.endsAt && trial.endsAt > new Date() ? trial.endsAt : new Date();
    const endsAt = addDays(base, days);

    await db
      .update(trials)
      .set({
        endsAt,
        status: 'active',
        extendedByDays: trial.extendedByDays + days,
        // Reminders already sent are cleared so the new window re-notifies.
        remindersSent: [],
        updatedAt: new Date(),
      })
      .where(eq(trials.id, trial.id));

    await db
      .update(tenants)
      .set({ status: 'trial', storeStatus: 'ready', updatedAt: new Date() })
      .where(eq(tenants.id, tenantRows[0].id));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.TRIAL_EXTENDED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      clientAccountId: id,
      tenantId: tenantRows[0].id,
      oldValue: trial.endsAt?.toISOString() ?? null,
      newValue: endsAt.toISOString(),
      metadata: { days },
    });

    return ok(reply, { endsAt });
  });

  app.post('/clients/:id/change-plan', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const body = parseBody(
      z.object({ planId: z.string().uuid(), billingCycle: z.enum(['monthly', 'yearly']) }),
      request.body,
    );

    const tenantRows = await db.select().from(tenants).where(eq(tenants.clientAccountId, id)).limit(1);
    if (!tenantRows[0]) throw notFound('This client has no store yet.', ERROR_CODES.TENANT_NOT_FOUND);

    const plan = await getActivePlanOrThrow(body.planId);
    const price = priceFor(plan, body.billingCycle);

    const existing = await db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, tenantRows[0].id))
      .limit(1);

    if (existing[0]) {
      await db
        .update(subscriptions)
        .set({ planId: plan.id, billingCycle: body.billingCycle, price, updatedAt: new Date() })
        .where(eq(subscriptions.id, existing[0].subscription.id));
    } else {
      await db.insert(subscriptions).values({
        tenantId: tenantRows[0].id,
        planId: plan.id,
        billingCycle: body.billingCycle,
        price,
        currency: config.payment.currency,
        status: 'active',
        startedAt: new Date(),
      });
    }

    await recordAudit(request, {
      action: AUDIT_ACTIONS.PLAN_CHANGED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      clientAccountId: id,
      tenantId: tenantRows[0].id,
      oldValue: existing[0]?.plan?.name ?? null,
      newValue: plan.name,
    });

    return ok(reply, { changed: true });
  });
}
