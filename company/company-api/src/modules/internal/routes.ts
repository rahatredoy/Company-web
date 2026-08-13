import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { domains, plans, subscriptions, tenants, trials } from '../../db/schema/index';
import { notFound } from '../../lib/errors';
import { ok, parseBody, parseParams } from '../../lib/http';
import { daysRemaining } from '../../lib/utils';

/**
 * Reserved for the Client Platform. Guarded by a shared secret header — never a
 * browser session — and deliberately narrow: the client platform reads
 * entitlement and reports usage, nothing more.
 *
 * Database name, host and credentials are never returned. The client platform
 * derives the database name from the slug with the same algorithm and holds its
 * own cluster credentials.
 */

type TenantJoin = {
  tenant: typeof tenants.$inferSelect;
  subscription: typeof subscriptions.$inferSelect | null;
  plan: typeof plans.$inferSelect | null;
};

/** Single payload builder so the by-ref, by-slug and by-domain routes can never drift. */
async function tenantPayload(row: TenantJoin) {
  const trialRows = await db.select().from(trials).where(eq(trials.tenantId, row.tenant.id)).limit(1);

  // Only verified, active domains are published. The storefront uses these to
  // build canonical URLs and to decide which browser origins may call the API,
  // so an unverified domain must never appear here.
  const domainRows = await db
    .select({ domain: domains.domain, domainType: domains.domainType, isPrimary: domains.isPrimary })
    .from(domains)
    .where(
      and(
        eq(domains.tenantId, row.tenant.id),
        eq(domains.verified, true),
        eq(domains.status, 'active'),
      ),
    );

  const storefrontDomains = domainRows.filter((d) => d.domainType !== 'admin_custom');

  return {
    tenantRef: row.tenant.tenantRef,
    slug: row.tenant.slug,
    storeName: row.tenant.storeName,
    status: row.tenant.status,
    storeStatus: row.tenant.storeStatus,
    currency: row.tenant.currency,
    language: row.tenant.language,
    timezone: row.tenant.timezone,
    /** Initial value only — the tenant's own storefront_settings is authoritative. */
    storefrontTemplate: row.tenant.storefrontTemplate,
    /**
     * Which shard of the tenant cluster holds this store's database.
     *
     * The id and nothing else: the host and credentials behind it are each
     * platform's own configuration, so this cannot redirect a store's traffic to
     * a server the commerce API was not already set up for. `null` is a store
     * provisioned before the cluster was sharded — the `legacy` shard.
     */
    databaseShard: row.tenant.databaseShard,
    /** Every hostname this store may legitimately be reached on. */
    domains: domainRows.map((d) => ({
      domain: d.domain,
      type: d.domainType,
      isPrimary: d.isPrimary,
    })),
    /**
     * The hostname canonical URLs must use. A custom primary domain wins over
     * the platform subdomain, so the same page is not indexed twice.
     */
    primaryDomain:
      storefrontDomains.find((d) => d.isPrimary && d.domainType === 'storefront_custom')?.domain ??
      storefrontDomains.find((d) => d.isPrimary)?.domain ??
      null,
    /** Entitlement the client platform enforces locally. */
    entitlements: row.plan
      ? {
          planCode: row.plan.code,
          planName: row.plan.name,
          supportLevel: row.plan.supportLevel,
          productLimit: row.plan.productLimit,
          adminLimit: row.plan.adminLimit,
          storageLimitMb: row.plan.storageLimitMb,
          customDomainEnabled: row.plan.customDomainEnabled,
          customAdminDomainEnabled: row.plan.customAdminDomainEnabled,
          analyticsEnabled: row.plan.analyticsEnabled,
          reportsEnabled: row.plan.reportsEnabled,
        }
      : null,
    subscriptionStatus: row.subscription?.status ?? null,
    trial: trialRows[0]
      ? {
          status: trialRows[0].status,
          endsAt: trialRows[0].endsAt,
          daysRemaining: trialRows[0].status === 'active' ? daysRemaining(trialRows[0].endsAt) : 0,
        }
      : null,
  };
}

function tenantQuery() {
  return db
    .select({ tenant: tenants, subscription: subscriptions, plan: plans })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId));
}

export default async function internalRoutes(app: FastifyInstance) {
  /**
   * Every provisioned store, for the operations that have to visit all of them
   * rather than one — `client-api`'s `db:migrate:tenants` after a deploy, above
   * all. Without this there was no way to enumerate tenants from the commerce
   * side, so "migrate every tenant" fell back to the single dev store and a
   * deploy left older stores on an older schema until a shopper happened to
   * trigger the in-band migration.
   *
   * Deliberately thinner than the by-ref payload: a slug, a ref and the shard is
   * all a sweep needs, and entitlements for hundreds of stores would be a large
   * response nobody reads. Drafts are excluded — `database_name` is null until
   * provisioning has actually made something.
   */
  app.get('/tenants', { preHandler: app.requireInternalKey }, async (request, reply) => {
    const rows = await db
      .select({
        tenantRef: tenants.tenantRef,
        slug: tenants.slug,
        storeName: tenants.storeName,
        status: tenants.status,
        storeStatus: tenants.storeStatus,
        databaseShard: tenants.databaseShard,
      })
      .from(tenants)
      .where(isNotNull(tenants.databaseName))
      .orderBy(tenants.createdAt);

    return ok(reply, rows);
  });

  app.get('/tenants/:tenantRef', { preHandler: app.requireInternalKey }, async (request, reply) => {
    const { tenantRef } = parseParams(
      z.object({ tenantRef: z.string().trim().min(4).max(24) }),
      request.params,
    );

    const rows = await tenantQuery().where(eq(tenants.tenantRef, tenantRef)).limit(1);
    const row = rows[0];
    if (!row) throw notFound('Tenant not found.');

    return ok(reply, await tenantPayload(row));
  });

  /**
   * Lookup by slug. The client admin panel is reached at `admin.<slug>.…`, so
   * the slug is the only identity it has on an unauthenticated request — this
   * saves it from opening a tenant database just to learn who is calling.
   */
  app.get('/tenants/by-slug/:slug', { preHandler: app.requireInternalKey }, async (request, reply) => {
    const { slug } = parseParams(
      z.object({ slug: z.string().trim().toLowerCase().min(3).max(40) }),
      request.params,
    );

    const rows = await tenantQuery().where(eq(tenants.slug, slug)).limit(1);
    const row = rows[0];
    if (!row) throw notFound('Tenant not found.');

    return ok(reply, await tenantPayload(row));
  });

  /**
   * Lookup by hostname, for storefronts reached on a connected custom domain.
   *
   * `abcfashion.com` carries no slug, so the storefront has nothing else to go
   * on. Only a verified, active domain resolves — an unverified one must not be
   * able to serve someone else's store, and a disabled one must stop working
   * immediately.
   */
  app.get('/tenants/by-domain/:host', { preHandler: app.requireInternalKey }, async (request, reply) => {
    const { host } = parseParams(
      z.object({
        host: z
          .string()
          .trim()
          .toLowerCase()
          .min(3)
          .max(253)
          // Hostname only — a port, path or scheme here would mean the caller
          // passed something it had not normalised.
          .regex(/^[a-z0-9.-]+$/, 'Not a hostname.'),
      }),
      request.params,
    );

    const matches = await db
      .select({ tenantId: domains.tenantId })
      .from(domains)
      .where(and(eq(domains.domain, host), eq(domains.verified, true), eq(domains.status, 'active')))
      .limit(1);

    const match = matches[0];
    if (!match) throw notFound('No store is connected to that domain.');

    const rows = await tenantQuery().where(eq(tenants.id, match.tenantId)).limit(1);
    const row = rows[0];
    if (!row) throw notFound('Tenant not found.');

    return ok(reply, await tenantPayload(row));
  });

  /**
   * Usage report from the client platform. Stored for the downgrade check; the
   * company side never queries a tenant database directly.
   */
  app.post('/tenants/:tenantRef/usage', { preHandler: app.requireInternalKey }, async (request, reply) => {
    const { tenantRef } = parseParams(
      z.object({ tenantRef: z.string().trim().min(4).max(24) }),
      request.params,
    );
    const body = parseBody(
      z.object({
        products: z.number().int().min(0),
        admins: z.number().int().min(0),
        storageMb: z.number().min(0),
      }),
      request.body,
    );

    const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.tenantRef, tenantRef)).limit(1);
    if (!rows[0]) throw notFound('Tenant not found.');

    const { systemSettings } = await import('../../db/schema/index');
    const key = `usage:${tenantRef}`;
    const existing = await db.select({ id: systemSettings.id }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);

    if (existing[0]) {
      await db
        .update(systemSettings)
        .set({ value: { ...body, reportedAt: new Date().toISOString() }, updatedAt: new Date() })
        .where(eq(systemSettings.id, existing[0].id));
    } else {
      await db.insert(systemSettings).values({ key, value: { ...body, reportedAt: new Date().toISOString() } });
    }

    return ok(reply, { recorded: true });
  });
}
