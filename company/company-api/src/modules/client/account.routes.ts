import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { clientAccounts, clientBusinessProfiles, clientSessions, tenants } from '../../db/schema/index';
import { ERROR_CODES, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { ok, parseBody, parseParams, uuidParamSchema } from '../../lib/http';
import { revokeAllClientSessions, revokeClientSession } from '../../lib/session';
import { latestInvoiceFor } from '../../services/billing';
import { isPlaceholderSlug } from '../../services/onboarding';
import { storeView, subscriptionView } from '../../services/views';

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: z
    .string()
    .trim()
    .min(6, 'Enter a valid phone number.')
    .max(24)
    .regex(/^\+?[0-9][0-9\s().-]{5,23}$/, 'Enter a valid phone number.'),
});

const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
  .refine((v) => /\d/.test(v), 'Include at least one number.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.');

/**
 * Invoice identity. Only the business name is required — signup asks for that
 * and nothing else, so every other field is optional until the client fills it
 * in here.
 */
const businessSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name.').max(160),
  ownerName: z.string().trim().min(2, 'Enter the owner name.').max(120),
  businessEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  businessPhone: z
    .string()
    .trim()
    .max(24)
    .regex(/^\+?[0-9][0-9\s().-]{5,23}$/, 'Enter a valid phone number.')
    .optional()
    .or(z.literal('')),
  country: z.string().trim().max(60).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  businessType: z
    .enum(['sole_proprietor', 'partnership', 'private_limited', 'public_limited', 'non_profit', 'other'])
    .optional()
    .or(z.literal('')),
});

function businessView(profile: typeof clientBusinessProfiles.$inferSelect | undefined) {
  if (!profile) return null;
  return {
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    businessEmail: profile.businessEmail,
    businessPhone: profile.businessPhone,
    country: profile.country,
    address: profile.address,
    businessType: profile.businessType,
  };
}

async function loadAccount(accountId: string) {
  const rows = await db.select().from(clientAccounts).where(eq(clientAccounts.id, accountId)).limit(1);
  return rows[0] ?? null;
}

function accountView(account: NonNullable<Awaited<ReturnType<typeof loadAccount>>>) {
  return {
    id: account.id,
    fullName: account.fullName,
    email: account.email,
    phone: account.phone,
    status: account.status,
    emailVerified: account.emailVerified,
    onboardingStep: account.onboardingStep,
    onboardingCompleted: account.onboardingCompleted,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  };
}

export default async function clientAccountRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: app.requireClient }, async (request, reply) => {
    const account = await loadAccount(request.clientAuth!.accountId);
    if (!account) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    return ok(reply, accountView(account));
  });

  app.put('/profile', { preHandler: app.requireClient }, async (request, reply) => {
    const body = parseBody(profileSchema, request.body);

    // Only these two fields are writable — status, verification and onboarding
    // flags can never be set from a request body.
    await db
      .update(clientAccounts)
      .set({ fullName: body.fullName, phone: body.phone, updatedAt: new Date() })
      .where(eq(clientAccounts.id, request.clientAuth!.accountId));

    const account = await loadAccount(request.clientAuth!.accountId);
    return ok(reply, accountView(account!));
  });

  app.post('/password', { preHandler: app.requireClient }, async (request, reply) => {
    const body = parseBody(
      z.object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: passwordSchema }),
      request.body,
    );

    const account = await loadAccount(request.clientAuth!.accountId);
    if (!account) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);

    const valid = await verifyPassword(account.passwordHash, body.currentPassword);
    if (!valid) throw unauthorized('Your current password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);

    const now = new Date();
    const passwordHash = await hashPassword(body.newPassword);

    await db
      .update(clientAccounts)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
      .where(eq(clientAccounts.id, account.id));

    // Keep this device signed in, drop every other one. The store admin panel
    // keeps its own login, so this change deliberately stops at this platform.
    await revokeAllClientSessions(account.id, request.clientAuth!.sessionId);

    return ok(reply, { updated: true });
  });

  app.get('/sessions', { preHandler: app.requireClient }, async (request, reply) => {
    const rows = await db
      .select()
      .from(clientSessions)
      .where(
        and(
          eq(clientSessions.clientAccountId, request.clientAuth!.accountId),
          isNull(clientSessions.revokedAt),
          gt(clientSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(clientSessions.lastSeenAt));

    return ok(
      reply,
      rows.map((row) => ({
        id: row.id,
        current: row.id === request.clientAuth!.sessionId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
      })),
    );
  });

  app.delete('/sessions/:id', { preHandler: app.requireClient }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);

    // Scope the lookup to this account so one client cannot revoke another's session.
    const rows = await db
      .select({ id: clientSessions.id })
      .from(clientSessions)
      .where(and(eq(clientSessions.id, id), eq(clientSessions.clientAccountId, request.clientAuth!.accountId)))
      .limit(1);

    if (rows[0]) await revokeClientSession(rows[0].id);
    return ok(reply, { revoked: true });
  });

  app.get('/business', { preHandler: app.requireClient }, async (request, reply) => {
    const rows = await db
      .select()
      .from(clientBusinessProfiles)
      .where(eq(clientBusinessProfiles.clientAccountId, request.clientAuth!.accountId))
      .limit(1);

    return ok(reply, businessView(rows[0]));
  });

  /**
   * Invoices snapshot these details at issue time, so editing them here changes
   * what future invoices say and never rewrites one already issued.
   */
  app.put('/business', { preHandler: app.requireClient }, async (request, reply) => {
    const body = parseBody(businessSchema, request.body);
    const accountId = request.clientAuth!.accountId;

    const values = {
      businessName: body.businessName,
      ownerName: body.ownerName,
      businessEmail: body.businessEmail,
      businessPhone: body.businessPhone || null,
      country: body.country || null,
      address: body.address || null,
      businessType: body.businessType || null,
    };

    const existing = await db
      .select({ id: clientBusinessProfiles.id })
      .from(clientBusinessProfiles)
      .where(eq(clientBusinessProfiles.clientAccountId, accountId))
      .limit(1);

    if (existing[0]) {
      await db
        .update(clientBusinessProfiles)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(clientBusinessProfiles.id, existing[0].id));
    } else {
      await db.insert(clientBusinessProfiles).values({ clientAccountId: accountId, ...values });
    }

    const rows = await db
      .select()
      .from(clientBusinessProfiles)
      .where(eq(clientBusinessProfiles.clientAccountId, accountId))
      .limit(1);

    return ok(reply, businessView(rows[0]));
  });

  /** One call that powers the account overview screen. */
  app.get('/overview', { preHandler: app.requireClient }, async (request, reply) => {
    const accountId = request.clientAuth!.accountId;
    const account = await loadAccount(accountId);
    if (!account) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);

    const [profileRows, tenantRows] = await Promise.all([
      db.select().from(clientBusinessProfiles).where(eq(clientBusinessProfiles.clientAccountId, accountId)).limit(1),
      db.select().from(tenants).where(eq(tenants.clientAccountId, accountId)).limit(1),
    ]);

    const profile = profileRows[0];
    const tenant = tenantRows[0];
    // The tenant exists from the moment a plan is chosen — it carries the
    // subscription and the payment — but it is not a *store* until signup names
    // it, and a placeholder address must never be shown as one.
    const namedTenant = tenant && !isPlaceholderSlug(tenant.slug) ? tenant : undefined;

    const [store, subscription, invoice] = await Promise.all([
      namedTenant ? storeView(namedTenant) : Promise.resolve(null),
      tenant ? subscriptionView(tenant.id) : Promise.resolve(null),
      tenant ? latestInvoiceFor(tenant.id) : Promise.resolve(null),
    ]);

    return ok(reply, {
      account: accountView(account),
      business: profile
        ? {
            businessName: profile.businessName,
            ownerName: profile.ownerName,
            businessEmail: profile.businessEmail,
            businessPhone: profile.businessPhone,
            country: profile.country,
            businessType: profile.businessType,
          }
        : null,
      store,
      subscription,
      latestInvoice: invoice
        ? {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            planName: null,
            billingCycle: invoice.billingCycle,
            amount: invoice.amount,
            currency: invoice.currency,
            status: invoice.status,
            issuedAt: invoice.issuedAt,
            paidAt: invoice.paidAt,
          }
        : null,
    });
  });
}
