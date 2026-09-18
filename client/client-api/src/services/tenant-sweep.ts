import { drizzle } from 'drizzle-orm/node-postgres';
import { count, sum } from 'drizzle-orm';
import { openTenantPool } from '../db/tenant-manager';
import { resolveShard } from '../db/tenant-shards';
import * as schema from '../db/schema/index';
import { productMedia, products, storeAdmins } from '../db/schema/index';
import { fetchAllTenants, reportUsage, type TenantSummary } from '../lib/company-client';
import { purgeExpiredSessions } from '../lib/session';
import { logger } from '../lib/logger';
import type { TenantDb } from '../db/tenant-manager';

/**
 * Housekeeping that has to visit every store.
 *
 * Each tenant gets a short-lived pool of its own rather than going through
 * `tenantDb`. That cache is sized for the stores currently being *used*, and a
 * sweep touches all of them — running it through the cache would evict every
 * warm pool in favour of stores nobody is looking at, so the next real request
 * to each one pays the reconnect.
 *
 * A store that fails is logged and skipped. One unreachable shard must not stop
 * the sweep reaching the stores that are up.
 */

export interface SweepResult {
  visited: number;
  skipped: number;
  failed: number;
  detail: Record<string, unknown>;
}

async function eachReadyTenant(
  task: (tenant: TenantSummary, db: TenantDb) => Promise<void>,
): Promise<SweepResult> {
  const tenants = await fetchAllTenants();
  const ready = tenants.filter((tenant) => tenant.storeStatus === 'ready');

  let visited = 0;
  let failed = 0;

  for (const tenant of ready) {
    let pool;
    try {
      pool = openTenantPool(tenant.slug, resolveShard(tenant.databaseShard));
      await task(tenant, drizzle(pool, { schema, casing: 'snake_case' }));
      visited += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        { slug: tenant.slug, tenantRef: tenant.tenantRef, err: (error as Error).message },
        'sweep skipped a store',
      );
    } finally {
      await pool?.end().catch(() => undefined);
    }
  }

  return {
    visited,
    skipped: tenants.length - ready.length,
    failed,
    detail: {},
  };
}

/**
 * Tidies the session index.
 *
 * There is nothing to delete any more: a session is a Redis record that expires
 * exactly when its token does, so an expired session removes itself. What
 * outlives it is the per-principal index that "sign out everywhere" reads, which
 * keeps naming records that are already gone — that is what this prunes.
 *
 * It no longer visits the stores one at a time. The keys are tenant-scoped
 * already, so one pass over the shared Redis covers every store at once and a
 * suspended or unreachable tenant cannot make the sweep fail.
 */
export async function sweepSessions(): Promise<SweepResult> {
  const pruned = await purgeExpiredSessions();

  logger.info({ pruned }, 'session index swept');

  return { visited: 0, skipped: 0, failed: 0, detail: { prunedIndexEntries: pruned } };
}

/**
 * Reports what each store is using, so the control plane can enforce plan limits
 * without opening a connection to a tenant database every time a dashboard is
 * drawn. It counts here, where the data is, and pushes a summary.
 */
export async function sweepUsage(): Promise<SweepResult> {
  let reported = 0;

  const result = await eachReadyTenant(async (tenant, db) => {
    const [productRow] = await db.select({ total: count() }).from(products);
    const [adminRow] = await db.select({ total: count() }).from(storeAdmins);
    const [mediaRow] = await db.select({ bytes: sum(productMedia.sizeBytes) }).from(productMedia);

    await reportUsage(tenant.tenantRef, {
      products: productRow?.total ?? 0,
      admins: adminRow?.total ?? 0,
      // Rounded up, so a store just over a limit is never reported as just under.
      storageMb: Math.ceil(Number(mediaRow?.bytes ?? 0) / 1_048_576),
    });

    reported += 1;
  });

  logger.info({ stores: reported, failed: result.failed }, 'store usage reported');
  return { ...result, detail: { reported } };
}
