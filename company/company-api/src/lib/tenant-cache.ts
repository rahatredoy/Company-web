import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { domains, tenants } from '../db/schema/index';
import { logger } from './logger';
import { redis } from './redis';

/**
 * Drops the Client Platform's cached copy of a tenant.
 *
 * `client-api` resolves every request's store through this control plane and
 * caches the answer in Redis for `TENANT_CACHE_TTL_SECONDS`. That cache is what
 * keeps a busy storefront from asking us on every request — but it also means a
 * change made here is invisible over there until it expires. For a status change
 * that is a minute of a suspended store still trading; for a domain change it is
 * a minute of a hostname resolving to the wrong tenant, or to none.
 *
 * Both platforms share one Redis, so the fix is to delete the keys rather than
 * to add a company → client call. The trust direction is deliberately one-way
 * (`client-api` → `company-api`, with an internal key); an endpoint here that
 * the client platform had to expose would reverse it.
 *
 * The key format mirrors `client-api/src/lib/company-client.ts`. It is copied on
 * purpose, like the rest of the shared helpers in this repo — but the two must
 * be changed together, so both sides name the other in a comment.
 */
const CACHE_PREFIX = 'tenant:v1:';

function keysFor(slug: string, hostnames: string[]): string[] {
  return [
    `${CACHE_PREFIX}${slug}`,
    ...hostnames.map((host) => `${CACHE_PREFIX}domain:${host.trim().toLowerCase()}`),
  ];
}

/**
 * Best-effort by design: a store's lifecycle must never fail because a cache
 * could not be reached. The TTL is the backstop — this only makes the change
 * land sooner.
 */
async function drop(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
    logger.debug({ keys: keys.length }, 'tenant cache invalidated');
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'tenant cache invalidation failed');
  }
}

/**
 * Invalidates by slug and by every hostname that resolves to it.
 *
 * `extraHostnames` covers the domain that has just been *removed*: it is already
 * gone from the table by the time this runs, and its cached entry is the one
 * that would otherwise keep serving a store from a hostname that no longer
 * belongs to it.
 */
export async function invalidateTenantCache(tenantId: string, extraHostnames: string[] = []): Promise<void> {
  const [tenantRow] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRow) return;

  const domainRows = await db
    .select({ domain: domains.domain })
    .from(domains)
    .where(eq(domains.tenantId, tenantId));

  await drop(keysFor(tenantRow.slug, [...domainRows.map((row) => row.domain), ...extraHostnames]));
}

/**
 * Same, for a caller that already holds the slug and hostnames and does not want
 * a second round trip to the database — provisioning, which has just written
 * both, is the case this exists for.
 */
export async function invalidateTenantCacheFor(slug: string, hostnames: string[] = []): Promise<void> {
  await drop(keysFor(slug, hostnames));
}
