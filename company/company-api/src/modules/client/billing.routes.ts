import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { invoices, payments, plans, subscriptions, tenants } from '../../db/schema/index';
import { AppError, ERROR_CODES, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, paginationSchema, uuidParamSchema } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { RATE_LIMITS } from '../../lib/constants';
import { recordActivity } from '../../lib/audit';
import { getActivePlanOrThrow, priceFor, startCheckout } from '../../services/billing';
import { subscriptionView } from '../../services/views';

async function loadTenant(accountId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.clientAccountId, accountId)).limit(1);
  const tenant = rows[0];
  if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);
  return tenant;
}

export default async function clientBillingRoutes(app: FastifyInstance) {
  app.get('/subscription', { preHandler: app.requireClient }, async (request, reply) => {
    const tenant = await loadTenant(request.clientAuth!.accountId);
    return ok(reply, await subscriptionView(tenant.id));
  });

  /**
   * Plan change. Upgrades and new paid plans go through the gateway; the
   * subscription itself only moves once a verified webhook lands.
   */
  app.post('/subscription/change', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'subscription-change', RATE_LIMITS.checkout);
    const body = parseBody(
      z.object({ planId: z.string().uuid(), billingCycle: z.enum(['monthly', 'yearly']) }),
      request.body,
    );

    const accountId = request.clientAuth!.accountId;
    const tenant = await loadTenant(accountId);
    const plan = await getActivePlanOrThrow(body.planId);

    // The trial is where a store starts, never somewhere it moves to. Anyone
    // reaching this route already has a store, so they have had their one
    // trial — switching "back" to it would be a second one.
    if (plan.isTrial) {
      throw new AppError(
        ERROR_CODES.TRIAL_ALREADY_USED,
        'The free trial is only available when you first set up billing. Choose a paid plan.',
        409,
      );
    }

    const currentRows = await db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.tenantId, tenant.id))
      .limit(1);

    const current = currentRows[0];

    /**
     * Downgrade guard. Usage totals live in the tenant platform, which does not
     * exist yet, so the contract is in place and reports zero usage for now —
     * when the client platform starts reporting, only this call changes.
     */
    if (current?.plan) {
      const goingDown = Number(plan.monthlyPrice) < Number(current.plan.monthlyPrice);
      if (goingDown) {
        const usage = await getTenantUsage();
        if (plan.productLimit !== null && usage.products > plan.productLimit) {
          throw new AppError(
            ERROR_CODES.DOWNGRADE_BLOCKED,
            `This plan allows ${plan.productLimit} products but your store has ${usage.products}. Reduce your catalogue first — nothing is deleted automatically.`,
            409,
          );
        }
        if (plan.adminLimit !== null && usage.admins > plan.adminLimit) {
          throw new AppError(
            ERROR_CODES.DOWNGRADE_BLOCKED,
            `This plan allows ${plan.adminLimit} admin accounts but your store has ${usage.admins}.`,
            409,
          );
        }
      }
    }

    const price = priceFor(plan, body.billingCycle);

    // A free plan (or an unchanged, still-trialling plan) needs no checkout.
    if (Number(price) === 0) {
      if (current) {
        await db
          .update(subscriptions)
          .set({ planId: plan.id, billingCycle: body.billingCycle, price, updatedAt: new Date() })
          .where(eq(subscriptions.id, current.subscription.id));
      }
      return ok(reply, await subscriptionView(tenant.id));
    }

    const checkout = await startCheckout({
      tenantId: tenant.id,
      clientAccountId: accountId,
      planId: plan.id,
      billingCycle: body.billingCycle,
      customerEmail: request.clientAuth!.email,
      description: `${plan.name} — ${tenant.storeName}`,
    });

    return ok(reply, { checkoutUrl: checkout.checkoutUrl });
  });

  app.post('/subscription/cancel', { preHandler: app.requireClient }, async (request, reply) => {
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.id)).limit(1);
    const subscription = rows[0];
    if (!subscription) throw notFound('No subscription to cancel.', ERROR_CODES.SUBSCRIPTION_NOT_FOUND);

    if (!['active', 'trial', 'past_due'].includes(subscription.status)) {
      throw new AppError(ERROR_CODES.SUBSCRIPTION_INVALID_STATE, 'This subscription cannot be cancelled.', 409);
    }

    const now = new Date();
    await db
      .update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(eq(subscriptions.id, subscription.id));

    // The store keeps running until the paid period ends; nothing is deleted.
    await recordActivity({
      type: 'subscription_cancelled',
      title: 'Subscription cancelled',
      subject: tenant.storeName,
      clientAccountId: request.clientAuth!.accountId,
      tenantId: tenant.id,
    });

    return ok(reply, await subscriptionView(tenant.id));
  });

  app.post('/subscription/reactivate', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'subscription-reactivate', RATE_LIMITS.checkout);
    const accountId = request.clientAuth!.accountId;
    const tenant = await loadTenant(accountId);

    const rows = await db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.tenantId, tenant.id))
      .limit(1);

    const current = rows[0];
    if (!current) throw notFound('No subscription to reactivate.', ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    if (!current.plan) throw notFound('The plan for this subscription no longer exists.', ERROR_CODES.PLAN_NOT_FOUND);

    // A trial has nothing to reactivate: renewing it is a 0.00 charge that would
    // hand out a second free week, and a third. It ends by being replaced.
    if (current.plan.isTrial) {
      throw new AppError(
        ERROR_CODES.TRIAL_ALREADY_USED,
        'Your free trial has ended. Choose a plan to bring your store back online.',
        409,
      );
    }

    // Cancelled but still inside the paid period: just clear the cancellation.
    if (
      current.subscription.status === 'cancelled' &&
      current.subscription.renewalAt &&
      current.subscription.renewalAt > new Date()
    ) {
      await db
        .update(subscriptions)
        .set({ status: 'active', cancelledAt: null, updatedAt: new Date() })
        .where(eq(subscriptions.id, current.subscription.id));
      return ok(reply, await subscriptionView(tenant.id));
    }

    const checkout = await startCheckout({
      tenantId: tenant.id,
      clientAccountId: accountId,
      planId: current.plan.id,
      billingCycle: current.subscription.billingCycle,
      customerEmail: request.clientAuth!.email,
      description: `${current.plan.name} — ${tenant.storeName}`,
    });

    return ok(reply, { checkoutUrl: checkout.checkoutUrl });
  });

  app.post('/payments/checkout', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'checkout', RATE_LIMITS.checkout);
    const body = parseBody(
      z.object({ planId: z.string().uuid(), billingCycle: z.enum(['monthly', 'yearly']) }),
      request.body,
    );

    const accountId = request.clientAuth!.accountId;
    const tenant = await loadTenant(accountId);
    const plan = await getActivePlanOrThrow(body.planId);

    // Nothing is bought at 0.00 by pointing checkout at the trial plan.
    if (plan.isTrial) {
      throw new AppError(
        ERROR_CODES.TRIAL_ALREADY_USED,
        'The free trial cannot be purchased. Choose a paid plan.',
        409,
      );
    }

    const checkout = await startCheckout({
      tenantId: tenant.id,
      clientAccountId: accountId,
      planId: plan.id,
      billingCycle: body.billingCycle,
      customerEmail: request.clientAuth!.email,
      description: `${plan.name} — ${tenant.storeName}`,
    });

    return ok(reply, { checkoutUrl: checkout.checkoutUrl });
  });

  app.get('/payments', { preHandler: app.requireClient }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const [rows, totals] = await Promise.all([
      db
        .select({ payment: payments, planName: plans.name })
        .from(payments)
        .leftJoin(plans, eq(payments.planId, plans.id))
        .where(eq(payments.tenantId, tenant.id))
        .orderBy(desc(payments.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ total: count() }).from(payments).where(eq(payments.tenantId, tenant.id)),
    ]);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.payment.id,
        transactionId: row.payment.transactionId,
        provider: row.payment.provider,
        planName: row.planName,
        amount: row.payment.amount,
        currency: row.payment.currency,
        status: row.payment.status,
        paidAt: row.payment.paidAt,
        createdAt: row.payment.createdAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.get('/invoices', { preHandler: app.requireClient }, async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query);
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const [rows, totals] = await Promise.all([
      db
        .select({ invoice: invoices, planName: plans.name })
        .from(invoices)
        .leftJoin(plans, eq(invoices.planId, plans.id))
        .where(eq(invoices.tenantId, tenant.id))
        .orderBy(desc(invoices.issuedAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ total: count() }).from(invoices).where(eq(invoices.tenantId, tenant.id)),
    ]);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.invoice.id,
        invoiceNumber: row.invoice.invoiceNumber,
        planName: row.planName,
        billingCycle: row.invoice.billingCycle,
        amount: row.invoice.amount,
        currency: row.invoice.currency,
        status: row.invoice.status,
        issuedAt: row.invoice.issuedAt,
        paidAt: row.invoice.paidAt,
      })),
      buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
    );
  });

  app.get('/invoices/:id', { preHandler: app.requireClient }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const rows = await db
      .select({ invoice: invoices, planName: plans.name })
      .from(invoices)
      .leftJoin(plans, eq(invoices.planId, plans.id))
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.id)))
      .limit(1);

    const row = rows[0];
    if (!row) throw notFound('Invoice not found.');

    return ok(reply, {
      id: row.invoice.id,
      invoiceNumber: row.invoice.invoiceNumber,
      planName: row.planName,
      billingCycle: row.invoice.billingCycle,
      amount: row.invoice.amount,
      currency: row.invoice.currency,
      status: row.invoice.status,
      billTo: row.invoice.billTo,
      issuedAt: row.invoice.issuedAt,
      paidAt: row.invoice.paidAt,
    });
  });

  /** Plain-text invoice download — no PDF toolchain needed for V1. */
  app.get('/invoices/:id/download', { preHandler: app.requireClient }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const rows = await db
      .select({ invoice: invoices, planName: plans.name })
      .from(invoices)
      .leftJoin(plans, eq(invoices.planId, plans.id))
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.id)))
      .limit(1);

    const row = rows[0];
    if (!row) throw notFound('Invoice not found.');

    const { renderInvoiceText } = await import('../../services/invoice-render');
    const body = renderInvoiceText(row.invoice, row.planName, tenant.storeName);

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${row.invoice.invoiceNumber}.txt"`);
    return reply.send(body);
  });
}

/**
 * Usage the downgrade check needs. The commerce data lives in the tenant
 * platform, which is a later phase — until it reports in, this returns zero and
 * the interface stays stable.
 */
async function getTenantUsage(): Promise<{ products: number; admins: number; storageMb: number }> {
  return { products: 0, admins: 1, storageMb: 0 };
}
