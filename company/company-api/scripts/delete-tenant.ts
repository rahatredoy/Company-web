/**
 * Removes a store: its tenant database, and the control-plane rows that point
 * at it.
 *
 *   npx tsx scripts/delete-tenant.ts --slug abc-fashion              # dry run
 *   npx tsx scripts/delete-tenant.ts --slug abc-fashion --yes
 *   npx tsx scripts/delete-tenant.ts --all --keep e-comarch --yes    # clear the rest
 *   npx tsx scripts/delete-tenant.ts --slug old-shop --with-account --yes
 *
 * Nothing is deleted without `--yes`: without it the script prints exactly what
 * it would remove and stops. A dropped tenant database cannot be recovered from
 * anywhere in this repo — there is no backup step and provisioning would rebuild
 * an empty store, not this one — so the default has to be the harmless one.
 *
 * The SaaS login is kept unless `--with-account` is passed. `tenants_client_key`
 * is a unique index on `client_account_id`, so removing the tenant row is what
 * frees that account to build a store again; deleting the account as well would
 * take the owner's plan, invoices and payment history with it (every one of
 * those cascades from `client_accounts`), which is rarely what "delete the
 * store" means.
 *
 * Order matters. The control-plane row goes first: while it exists `client-api`
 * still resolves the hostname and will hand a request a database that is being
 * dropped underneath it. The Redis record is dropped in the same breath for the
 * reason `lib/tenant-cache.ts` exists — otherwise the store keeps trading from
 * cache for up to the TTL after its database has gone.
 */
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { clientAccounts, domains, tenants } from '../src/db/schema/index';
import { locateShard, resolveShard, shardClientOptions } from '../src/services/tenant-shards';
import { invalidateTenantCacheFor } from '../src/lib/tenant-cache';
import { redis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

function list(name: string): string[] {
  return (arg(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const CONFIRMED = process.argv.includes('--yes');
const ALL = process.argv.includes('--all');
const WITH_ACCOUNT = process.argv.includes('--with-account');
const SLUGS = list('slug');
const KEEP = list('keep');

/**
 * Drops the database wherever it actually is.
 *
 * `tenants.database_shard` is the authority, but a store moved by
 * `move-tenant-to-shard.ts` without `--drop-source` leaves a copy answering to
 * the same name on the old server, so the recorded shard is tried first and
 * `locateShard` sweeps for a straggler afterwards.
 */
async function dropDatabase(databaseName: string, shardId: string | null): Promise<string[]> {
  const dropped: string[] = [];
  const seen = new Set<string>();

  const candidates = [recordedShard(shardId), await locateShard(databaseName)];

  for (const shard of candidates) {
    if (!shard || seen.has(shard.id)) continue;
    seen.add(shard.id);

    const admin = new pg.Client(shardClientOptions(shard, 'postgres'));
    await admin.connect();
    try {
      const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [databaseName]);
      if (!rowCount) continue;
      // `with (force)` terminates the client-api pool's idle connections; without
      // it a dev server that has ever served this store blocks the drop.
      await admin.query(`drop database if exists "${databaseName}" with (force)`);
      dropped.push(shard.id);
    } finally {
      await admin.end().catch(() => undefined);
    }
  }

  return dropped;
}

/** The shard the tenant row names, or null if this deployment has no such id. */
function recordedShard(shardId: string | null) {
  try {
    return resolveShard(shardId);
  } catch {
    // An id no longer in TENANT_SHARDS — the sweep below is the fallback.
    return null;
  }
}

async function main(): Promise<void> {
  if (!ALL && SLUGS.length === 0) {
    throw new Error('Name what to remove: --slug a,b  (or --all --keep <slug>)');
  }
  if (ALL && KEEP.length === 0 && SLUGS.length === 0) {
    throw new Error('--all with nothing kept would empty the platform. Pass --keep <slug>.');
  }

  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      tenantRef: tenants.tenantRef,
      storeName: tenants.storeName,
      databaseName: tenants.databaseName,
      databaseShard: tenants.databaseShard,
      status: tenants.status,
      storeStatus: tenants.storeStatus,
      accountId: clientAccounts.id,
      accountEmail: clientAccounts.email,
    })
    .from(tenants)
    .innerJoin(clientAccounts, eq(tenants.clientAccountId, clientAccounts.id));

  const targets = ALL
    ? rows.filter((row) => !KEEP.includes(row.slug))
    : rows.filter((row) => SLUGS.includes(row.slug));

  const missing = SLUGS.filter((slug) => !rows.some((row) => row.slug === slug));
  for (const slug of missing) console.log(`  ! no tenant named "${slug}" — skipped`);

  const kept = rows.filter((row) => !targets.includes(row));

  console.log(`\n  keeping ${kept.length} store(s):`);
  for (const row of kept) console.log(`    ${row.slug}  (${row.databaseName ?? 'no database'})`);

  console.log(`\n  ${CONFIRMED ? 'removing' : 'would remove'} ${targets.length} store(s):`);
  for (const row of targets) {
    console.log(`    ${row.slug}  ${row.databaseName ?? '(no database)'}  shard=${row.databaseShard ?? 'legacy'}`);
    console.log(`      ${row.storeName} — ${row.status}/${row.storeStatus}, owner ${row.accountEmail}`);
    console.log(
      `      account ${row.accountEmail} ${WITH_ACCOUNT ? 'WILL BE DELETED' : 'kept (can build a new store)'}`,
    );
  }

  if (targets.length === 0) {
    console.log('\n  nothing to do.');
    return;
  }

  if (!CONFIRMED) {
    console.log('\n  dry run — nothing was deleted. Re-run with --yes to go ahead.\n');
    return;
  }

  console.log('');
  for (const row of targets) {
    // Every hostname that resolves to this store has its own cache key, and the
    // rows are about to cascade away, so they are read while they still exist.
    const hostnames = (
      await db.select({ domain: domains.domain }).from(domains).where(eq(domains.tenantId, row.id))
    ).map((entry) => entry.domain);

    if (WITH_ACCOUNT) {
      await db.delete(clientAccounts).where(eq(clientAccounts.id, row.accountId));
    } else {
      await db.delete(tenants).where(eq(tenants.id, row.id));
    }
    console.log(`  ▸ ${row.slug}: control-plane rows deleted`);

    await invalidateTenantCacheFor(row.slug, hostnames);
    console.log(`  ▸ ${row.slug}: cache dropped (${hostnames.length} hostname(s))`);

    if (row.databaseName) {
      const dropped = await dropDatabase(row.databaseName, row.databaseShard);
      console.log(
        dropped.length
          ? `  ▸ ${row.slug}: dropped ${row.databaseName} on ${dropped.join(', ')}`
          : `  ▸ ${row.slug}: ${row.databaseName} was not on any known shard`,
      );
    }
  }

  console.log('');
}

main()
  .then(async () => {
    await pool.end();
    redis.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(`\n  failed: ${(error as Error).message}\n`);
    await pool.end().catch(() => undefined);
    redis.disconnect();
    process.exit(1);
  });
