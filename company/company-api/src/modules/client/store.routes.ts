import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { plans, provisioningJobs, subscriptions, tenants } from '../../db/schema/index';
import { config } from '../../config/index';
import { RATE_LIMITS } from '../../lib/constants';
import { AppError, ERROR_CODES, notFound } from '../../lib/errors';
import { ok, parseBody } from '../../lib/http';
import { emails } from '../../lib/mailer';
import { hashPassword } from '../../lib/password';
import { enforce } from '../../lib/rate-limit';
import { queueProvisioning } from '../../queues/index';
import { isPlaceholderSlug } from '../../services/onboarding';
import { runProvisioning } from '../../services/provisioning';
import {
  applyStoreAdminPassword,
  assertResendAllowed,
  consumeStoreAdminOtp,
  issueStoreAdminOtp,
} from '../../services/store-admin';
import { readStoreUsage } from '../../services/store-usage';
import { storeView } from '../../services/views';

/** Same password rules as the one chosen at setup — see `onboarding.routes`. */
const resetSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'Password is too long.')
    .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
    .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
    .refine((v) => /\d/.test(v), 'Include at least one number.')
    .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.'),
});

/**
 * A tenant row exists from the moment a plan is chosen, but it is not a store
 * until signup names it. Returning the placeholder here would publish an address
 * that does not exist — and does not belong to this client — so it is treated as
 * "no store yet", exactly as the account overview does.
 */
async function loadTenant(accountId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.clientAccountId, accountId)).limit(1);
  const tenant = rows[0];
  if (!tenant || isPlaceholderSlug(tenant.slug)) return null;
  return tenant;
}

export default async function clientStoreRoutes(app: FastifyInstance) {
  app.get('/store', { preHandler: app.requireClient }, async (request, reply) => {
    const tenant = await loadTenant(request.clientAuth!.accountId);
    if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);
    return ok(reply, await storeView(tenant));
  });

  /**
   * What the store is using against what the plan allows. Counted in the tenant
   * database, because the control database holds the limits and none of the
   * things being limited.
   */
  app.get('/store/usage', { preHandler: app.requireClient }, async (request, reply) => {
    const tenant = await loadTenant(request.clientAuth!.accountId);
    if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);

    const [usage, planRows] = await Promise.all([
      readStoreUsage(tenant),
      db
        .select({ plan: plans })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.tenantId, tenant.id))
        .limit(1),
    ]);

    const plan = planRows[0]?.plan ?? null;

    return ok(reply, {
      ...usage,
      limits: {
        products: plan?.productLimit ?? null,
        admins: plan?.adminLimit ?? null,
        storageMb: plan?.storageLimitMb ?? null,
      },
    });
  });

  /** Client-initiated retry after a failed provisioning run. */
  app.post('/store/retry-provisioning', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'retry-provisioning', { max: 5, windowSeconds: 900 });

    const tenant = await loadTenant(request.clientAuth!.accountId);
    if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);

    const jobRows = await db
      .select({ status: provisioningJobs.status })
      .from(provisioningJobs)
      .where(eq(provisioningJobs.tenantId, tenant.id))
      .limit(1);

    if (jobRows[0]?.status === 'creating') {
      throw new AppError(ERROR_CODES.PROVISIONING_IN_PROGRESS, 'Provisioning is already running.', 409);
    }
    if (jobRows[0]?.status === 'completed') {
      return ok(reply, await storeView(tenant));
    }

    const queued = await queueProvisioning(tenant.id);
    if (!queued) await runProvisioning(tenant.id);

    const refreshed = await loadTenant(request.clientAuth!.accountId);
    return ok(reply, await storeView(refreshed!));
  });

  /**
   * Store admin password reset, step one.
   *
   * The code goes to the store admin address, not to the SaaS account signed in
   * here — those are two different logins on purpose, and being able to read the
   * panel's mailbox is exactly what this has to prove.
   */
  app.post('/store/admin-password/request', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'store-admin-reset', RATE_LIMITS.storeAdminOtp);

    const accountId = request.clientAuth!.accountId;
    const tenant = await loadTenant(accountId);
    if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);

    if (!tenant.storeAdminEmail) {
      throw new AppError(
        ERROR_CODES.STORE_ADMIN_NOT_FOUND,
        'This store has no admin login recorded. Contact support.',
        409,
      );
    }
    if (tenant.storeStatus === 'creating') {
      throw new AppError(
        ERROR_CODES.PROVISIONING_IN_PROGRESS,
        'Your store is still being created. Try again once it is ready.',
        409,
      );
    }

    assertResendAllowed(tenant, 'admin_password_reset');

    const challenge = await issueStoreAdminOtp(tenant.id, 'admin_password_reset', tenant.storeAdminEmail);
    await emails.storeAdminResetCode(tenant.storeAdminEmail, challenge.code, config.security.otpTtlMinutes, {
      clientAccountId: accountId,
      tenantId: tenant.id,
    });

    return ok(reply, { sentTo: challenge.sentTo, expiresAt: challenge.expiresAt.toISOString() });
  });

  /**
   * Step two: the code and the new password together. The password is only
   * accepted alongside a code that has not been spent, so a stolen dashboard
   * session cannot change the panel's password on its own.
   */
  app.post('/store/admin-password/reset', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'store-admin-reset-verify', RATE_LIMITS.storeAdminOtpVerify);

    const body = parseBody(resetSchema, request.body);
    const tenant = await loadTenant(request.clientAuth!.accountId);
    if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);

    await consumeStoreAdminOtp(tenant.id, 'admin_password_reset', body.code);
    await applyStoreAdminPassword(tenant, await hashPassword(body.password));

    return ok(reply, { reset: true, adminEmail: tenant.storeAdminEmail });
  });

  app.get('/notifications', { preHandler: app.requireClient }, async (request, reply) => {
    const { notifications } = await import('../../db/schema/index');
    const { desc } = await import('drizzle-orm');

    const rows = await db
      .select({
        id: notifications.id,
        template: notifications.template,
        subject: notifications.subject,
        channel: notifications.channel,
        status: notifications.status,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.clientAccountId, request.clientAuth!.accountId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return ok(reply, rows);
  });
}
