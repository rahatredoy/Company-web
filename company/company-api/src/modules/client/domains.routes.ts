import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { domains, plans, subscriptions, tenants } from '../../db/schema/index';
import { config } from '../../config/index';
import { AppError, ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { ok, parseBody, parseParams, uuidParamSchema } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { RATE_LIMITS } from '../../lib/constants';
import { generateToken } from '../../lib/crypto';
import { validateCustomDomain } from '../../lib/utils';
import { checkDomain, dnsInstructions } from '../../lib/dns';
import { recordActivity } from '../../lib/audit';
import { invalidateTenantCache } from '../../lib/tenant-cache';
import { domainView } from '../../services/views';

async function loadTenant(accountId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.clientAccountId, accountId)).limit(1);
  const tenant = rows[0];
  if (!tenant) throw notFound('No store has been created for this account yet.', ERROR_CODES.TENANT_NOT_FOUND);
  return tenant;
}

async function planFor(tenantId: string) {
  const rows = await db
    .select({ plan: plans })
    .from(subscriptions)
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return rows[0]?.plan ?? null;
}

export default async function clientDomainRoutes(app: FastifyInstance) {
  app.get('/domains', { preHandler: app.requireClient }, async (request, reply) => {
    const tenant = await loadTenant(request.clientAuth!.accountId);
    const rows = await db.select().from(domains).where(eq(domains.tenantId, tenant.id));

    return ok(
      reply,
      rows.map((row) =>
        domainView(
          row,
          row.domainType === 'platform_subdomain' || !row.verificationToken
            ? []
            : dnsInstructions(row.domain, row.verificationToken),
        ),
      ),
    );
  });

  app.post('/domains', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'domain-create', RATE_LIMITS.domainCreate);
    const body = parseBody(
      z.object({
        domain: z.string().trim().min(4).max(253),
        domainType: z.enum(['storefront_custom', 'admin_custom']),
      }),
      request.body,
    );

    const tenant = await loadTenant(request.clientAuth!.accountId);
    const plan = await planFor(tenant.id);

    const allowed =
      body.domainType === 'storefront_custom' ? plan?.customDomainEnabled : plan?.customAdminDomainEnabled;
    if (!allowed) {
      throw new AppError(
        ERROR_CODES.CUSTOM_DOMAIN_NOT_IN_PLAN,
        'Your current plan does not include custom domains. Upgrade to connect one.',
        403,
      );
    }

    const check = validateCustomDomain(body.domain, config.urls.platformRootDomain);
    if (!check.ok) {
      throw new AppError(
        check.reason === 'blocked' ? ERROR_CODES.DOMAIN_BLOCKED : ERROR_CODES.DOMAIN_INVALID,
        check.message,
        422,
        { details: { domain: [check.message] } },
      );
    }

    const taken = await db.select({ id: domains.id }).from(domains).where(eq(domains.domain, check.value)).limit(1);
    if (taken[0]) throw conflict('That domain is already connected to a store.', ERROR_CODES.DOMAIN_TAKEN);

    const verificationToken = generateToken(16);
    const [created] = await db
      .insert(domains)
      .values({
        tenantId: tenant.id,
        domain: check.value,
        domainType: body.domainType,
        verificationToken,
        status: 'pending',
      })
      .returning();

    return ok(reply, domainView(created!, dnsInstructions(check.value, verificationToken)), 201);
  });

  app.post('/domains/:id/verify', { preHandler: app.requireClient }, async (request, reply) => {
    await enforce(request, 'domain-verify', RATE_LIMITS.domainVerify);
    const { id } = parseParams(uuidParamSchema, request.params);
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const rows = await db
      .select()
      .from(domains)
      .where(and(eq(domains.id, id), eq(domains.tenantId, tenant.id)))
      .limit(1);

    const domain = rows[0];
    if (!domain) throw notFound('Domain not found.');
    if (domain.domainType === 'platform_subdomain') {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'Platform subdomains are managed automatically.', 400);
    }
    if (!domain.verificationToken) {
      throw new AppError(ERROR_CODES.DOMAIN_INVALID, 'This domain has no verification token.', 409);
    }

    const now = new Date();
    await db.update(domains).set({ status: 'verifying', lastCheckedAt: now }).where(eq(domains.id, domain.id));

    const result = await checkDomain(domain.domain, domain.verificationToken);

    // A domain only goes active once ownership is proven — never on a claim alone.
    if (result.ownershipVerified) {
      await db
        .update(domains)
        .set({
          verified: true,
          status: 'active',
          verifiedAt: now,
          lastCheckedAt: now,
          lastError: result.pointsToPlatform ? null : 'DNS target not pointing at the platform yet.',
          updatedAt: now,
        })
        .where(eq(domains.id, domain.id));

      if (domain.domainType === 'storefront_custom') {
        await db
          .update(domains)
          .set({ isPrimary: false })
          .where(and(eq(domains.tenantId, tenant.id), eq(domains.domainType, 'platform_subdomain')));
        await db.update(domains).set({ isPrimary: true }).where(eq(domains.id, domain.id));
      }

      await recordActivity({
        type: 'domain_connected',
        title: 'Domain connected',
        subject: domain.domain,
        clientAccountId: request.clientAuth!.accountId,
        tenantId: tenant.id,
      });
    } else {
      await db
        .update(domains)
        .set({
          status: 'pending',
          lastCheckedAt: now,
          lastError: result.error ?? 'Verification TXT record not found yet.',
          updatedAt: now,
        })
        .where(eq(domains.id, domain.id));
    }

    // Whether it passed or not, what the client platform has cached for this
    // tenant is now stale: a newly verified hostname has to start resolving, and
    // a `primaryDomain` handover has to reach the storefront's canonical URLs.
    await invalidateTenantCache(tenant.id);

    const refreshed = await db.select().from(domains).where(eq(domains.id, domain.id)).limit(1);
    return ok(
      reply,
      domainView(refreshed[0]!, dnsInstructions(domain.domain, domain.verificationToken)),
    );
  });

  app.delete('/domains/:id', { preHandler: app.requireClient }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    const tenant = await loadTenant(request.clientAuth!.accountId);

    const rows = await db
      .select()
      .from(domains)
      .where(and(eq(domains.id, id), eq(domains.tenantId, tenant.id)))
      .limit(1);

    const domain = rows[0];
    if (!domain) throw notFound('Domain not found.');
    if (domain.domainType === 'platform_subdomain') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'The platform subdomain cannot be removed.', 403);
    }

    await db.delete(domains).where(eq(domains.id, domain.id));

    // Hand primary back to the platform subdomain so the store stays reachable.
    if (domain.isPrimary) {
      await db
        .update(domains)
        .set({ isPrimary: true })
        .where(and(eq(domains.tenantId, tenant.id), eq(domains.domainType, 'platform_subdomain')));
    }

    // The removed hostname is named explicitly — it is no longer in the table to
    // be found, and its cached entry is precisely the one that would otherwise
    // keep serving this store from an address that is not ours any more.
    await invalidateTenantCache(tenant.id, [domain.domain]);

    return ok(reply, { removed: true });
  });
}
