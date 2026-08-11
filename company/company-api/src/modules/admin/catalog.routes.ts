import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, lt, or } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  clientAccounts,
  clientBusinessProfiles,
  plans,
  subscriptions,
  tenants,
  trials,
} from '../../db/schema/index';
import { config } from '../../config/index';
import { AppError, ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, paginationSchema, uuidParamSchema } from '../../lib/http';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { addDays, daysRemaining, toMoney } from '../../lib/utils';
import { planAdminView } from '../../services/views';
import { trialSummary } from '../../services/dashboard';

const money = z.union([z.string(), z.number()]).transform((v) => toMoney(v));
const nullableInt = z.union([z.number().int().min(0), z.null()]).optional();

const planInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter a plan name.').max(60),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'Lowercase letters, numbers and hyphens only.'),
  description: z.string().trim().max(200).nullable().optional(),
  monthlyPrice: money,
  yearlyPrice: money,
  productLimit: nullableInt,
  adminLimit: nullableInt,
  storageLimitMb: nullableInt,
  customDomainEnabled: z.boolean().default(false),
  customAdminDomainEnabled: z.boolean().default(false),
  analyticsEnabled: z.boolean().default(false),
  reportsEnabled: z.boolean().default(false),
  supportLevel: z.enum(['email', 'priority', 'dedicated']).default('email'),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export default async function adminCatalogRoutes(app: FastifyInstance) {
  // --- Plans ------------------------------------------------------------------

  app.get('/plans', { preHandler: app.requireAdmin }, async (_request, reply) => {
    const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.monthlyPrice));

    const counts = await db
      .select({ planId: subscriptions.planId, total: count() })
      .from(subscriptions)
      .groupBy(subscriptions.planId);

    const byPlan = new Map(counts.map((row) => [row.planId, Number(row.total)]));
    return ok(reply, rows.map((plan) => planAdminView(plan, byPlan.get(plan.id) ?? 0)));
  });

  app.post('/plans', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseBody(planInputSchema, request.body);

    const existing = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, body.code)).limit(1);
    if (existing[0]) throw conflict('A plan with that code already exists.', ERROR_CODES.PLAN_CODE_TAKEN);

    const [created] = await db
      .insert(plans)
      .values({
        name: body.name,
        code: body.code,
        description: body.description ?? null,
        monthlyPrice: body.monthlyPrice,
        yearlyPrice: body.yearlyPrice,
        productLimit: body.productLimit ?? null,
        adminLimit: body.adminLimit ?? null,
        storageLimitMb: body.storageLimitMb ?? null,
        customDomainEnabled: body.customDomainEnabled,
        customAdminDomainEnabled: body.customAdminDomainEnabled,
        analyticsEnabled: body.analyticsEnabled,
        reportsEnabled: body.reportsEnabled,
        supportLevel: body.supportLevel,
        isFeatured: body.isFeatured,
        sortOrder: body.sortOrder,
      })
      .returning();

    await recordAudit(request, {
      action: AUDIT_ACTIONS.PLAN_CREATED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      targetLabel: created!.name,
      newValue: `${created!.code} · ${created!.monthlyPrice}/mo`,
    });

    return ok(reply, planAdminView(created!), 201);
  });

  app.put('/plans/:id', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    // `code` is immutable once created — it appears in links and payment records.
    const body = parseBody(planInputSchema.omit({ code: true }), request.body);

    const existing = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!existing[0]) throw notFound('Plan not found.', ERROR_CODES.PLAN_NOT_FOUND);

    const [updated] = await db
      .update(plans)
      .set({
        name: body.name,
        description: body.description ?? null,
        monthlyPrice: body.monthlyPrice,
        yearlyPrice: body.yearlyPrice,
        productLimit: body.productLimit ?? null,
        adminLimit: body.adminLimit ?? null,
        storageLimitMb: body.storageLimitMb ?? null,
        customDomainEnabled: body.customDomainEnabled,
        customAdminDomainEnabled: body.customAdminDomainEnabled,
        analyticsEnabled: body.analyticsEnabled,
        reportsEnabled: body.reportsEnabled,
        supportLevel: body.supportLevel,
        isFeatured: body.isFeatured,
        sortOrder: body.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, id))
      .returning();

    await recordAudit(request, {
      action: AUDIT_ACTIONS.PLAN_UPDATED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      targetLabel: updated!.name,
      oldValue: `${existing[0].monthlyPrice}/mo`,
      newValue: `${updated!.monthlyPrice}/mo`,
    });

    return ok(reply, planAdminView(updated!));
  });

  app.post('/plans/:id/status', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const { status } = parseBody(z.object({ status: z.enum(['active', 'disabled']) }), request.body);

    const existing = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!existing[0]) throw notFound('Plan not found.', ERROR_CODES.PLAN_NOT_FOUND);

    // Disabling only hides the plan from new signups; existing subscribers keep it.
    await db.update(plans).set({ status, updatedAt: new Date() }).where(eq(plans.id, id));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.PLAN_STATUS_CHANGED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      targetLabel: existing[0].name,
      oldValue: existing[0].status,
      newValue: status,
    });

    return ok(reply, { status });
  });

  // --- Trials -----------------------------------------------------------------

  app.get('/trials/summary', { preHandler: app.requireAdmin }, async (_request, reply) => {
    return ok(reply, await trialSummary());
  });

  app.get('/trials', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(
        or(ilike(clientBusinessProfiles.businessName, `%${search}%`), ilike(tenants.tenantRef, `%${search}%`)),
      );
    }
    if (query.status === 'expiring') {
      conditions.push(and(eq(trials.status, 'active'), lt(trials.endsAt, addDays(new Date(), 5))));
    } else if (query.status && query.status !== 'all') {
      conditions.push(eq(trials.status, query.status as 'active' | 'expired' | 'converted' | 'cancelled'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        id: trials.id,
        tenantRef: tenants.tenantRef,
        clientId: clientAccounts.id,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        startedAt: trials.startedAt,
        endsAt: trials.endsAt,
        status: trials.status,
      })
      .from(trials)
      .innerJoin(tenants, eq(tenants.id, trials.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(trials.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(trials)
      .innerJoin(tenants, eq(tenants.id, trials.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantRef,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        startedAt: row.startedAt,
        endsAt: row.endsAt,
        daysRemaining: row.status === 'active' ? daysRemaining(row.endsAt) : 0,
        status: row.status,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.post('/trials/:id/extend', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const { days } = parseBody(z.object({ days: z.coerce.number().int().min(1).max(365) }), request.body);

    const rows = await db.select().from(trials).where(eq(trials.id, id)).limit(1);
    const trial = rows[0];
    if (!trial) throw notFound('Trial not found.', ERROR_CODES.TRIAL_NOT_FOUND);

    const base = trial.endsAt && trial.endsAt > new Date() ? trial.endsAt : new Date();
    const endsAt = addDays(base, days);

    await db
      .update(trials)
      .set({
        endsAt,
        status: 'active',
        extendedByDays: trial.extendedByDays + days,
        remindersSent: [],
        updatedAt: new Date(),
      })
      .where(eq(trials.id, id));

    await db
      .update(tenants)
      .set({ status: 'trial', storeStatus: 'ready', updatedAt: new Date() })
      .where(eq(tenants.id, trial.tenantId));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.TRIAL_EXTENDED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: trial.tenantId,
      oldValue: trial.endsAt?.toISOString() ?? null,
      newValue: endsAt.toISOString(),
      metadata: { days },
    });

    return ok(reply, { endsAt });
  });

  app.post('/trials/:id/end', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(trials).where(eq(trials.id, id)).limit(1);
    const trial = rows[0];
    if (!trial) throw notFound('Trial not found.', ERROR_CODES.TRIAL_NOT_FOUND);
    if (trial.status !== 'active') {
      throw new AppError(ERROR_CODES.TRIAL_NOT_ACTIVE, 'This trial is not active.', 409);
    }

    const now = new Date();
    await db.update(trials).set({ status: 'expired', endsAt: now, updatedAt: now }).where(eq(trials.id, id));

    // The store is paused, not deleted.
    await db
      .update(tenants)
      .set({ status: 'expired', storeStatus: 'suspended', updatedAt: now })
      .where(eq(tenants.id, trial.tenantId));

    await db
      .update(subscriptions)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(subscriptions.tenantId, trial.tenantId), eq(subscriptions.status, 'trial')));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.TRIAL_ENDED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: trial.tenantId,
      oldValue: 'active',
      newValue: 'expired',
    });

    return ok(reply, { ended: true });
  });

  // --- Subscriptions ----------------------------------------------------------

  app.get('/subscriptions', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const search = query.search?.trim();

    const conditions = [];
    if (search) {
      conditions.push(or(ilike(clientBusinessProfiles.businessName, `%${search}%`), ilike(plans.name, `%${search}%`)));
    }
    if (query.status && query.status !== 'all') {
      conditions.push(
        eq(
          subscriptions.status,
          query.status as 'trial' | 'active' | 'past_due' | 'expired' | 'cancelled' | 'suspended',
        ),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = db
      .select({
        id: subscriptions.id,
        clientId: clientAccounts.id,
        businessName: clientBusinessProfiles.businessName,
        fullName: clientAccounts.fullName,
        planName: plans.name,
        billingCycle: subscriptions.billingCycle,
        price: subscriptions.price,
        currency: subscriptions.currency,
        startedAt: subscriptions.startedAt,
        renewalAt: subscriptions.renewalAt,
        cancelledAt: subscriptions.cancelledAt,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId));

    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(subscriptions.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const totalBase = db
      .select({ total: count() })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId));

    const totals = await (where ? totalBase.where(where) : totalBase);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.id,
        clientId: row.clientId,
        businessName: row.businessName ?? row.fullName,
        planName: row.planName,
        billingCycle: row.billingCycle,
        price: row.price,
        currency: row.currency ?? config.payment.currency,
        startedAt: row.startedAt,
        renewalAt: row.renewalAt,
        cancelledAt: row.cancelledAt,
        status: row.status,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.post('/subscriptions/:id/cancel', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    const subscription = rows[0];
    if (!subscription) throw notFound('Subscription not found.', ERROR_CODES.SUBSCRIPTION_NOT_FOUND);

    const now = new Date();
    await db
      .update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(eq(subscriptions.id, id));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: subscription.tenantId,
      oldValue: subscription.status,
      newValue: 'cancelled',
    });

    return ok(reply, { cancelled: true });
  });

  app.post('/subscriptions/:id/reactivate', { preHandler: app.requireAdminReauth }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    const subscription = rows[0];
    if (!subscription) throw notFound('Subscription not found.', ERROR_CODES.SUBSCRIPTION_NOT_FOUND);

    const now = new Date();
    await db
      .update(subscriptions)
      .set({ status: 'active', cancelledAt: null, endedAt: null, updatedAt: now })
      .where(eq(subscriptions.id, id));

    await db
      .update(tenants)
      .set({ status: 'active', storeStatus: 'ready', suspendedAt: null, updatedAt: now })
      .where(eq(tenants.id, subscription.tenantId));

    await recordAudit(request, {
      action: AUDIT_ACTIONS.SUBSCRIPTION_REACTIVATED,
      actorId: request.adminAuth!.adminId,
      actorLabel: request.adminAuth!.email,
      tenantId: subscription.tenantId,
      oldValue: subscription.status,
      newValue: 'active',
    });

    return ok(reply, { reactivated: true });
  });
}
