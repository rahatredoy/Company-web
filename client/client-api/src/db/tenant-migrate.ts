import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { logger } from '../lib/logger';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Current commerce schema version, mirrored into `platform_sync` for visibility.
 *
 * Bump this whenever a migration is added — a tenant already at this version is
 * skipped without opening the migrator at all, so forgetting to bump it means
 * existing stores silently never receive the new tables.
 */
export const COMMERCE_SCHEMA_VERSION = '1.5.0';

/**
 * A stable 64-bit key for `pg_advisory_lock`. Postgres advisory locks are
 * per-database, and each tenant has its own database, so a single constant is
 * enough to serialise migration runs for that tenant across every process.
 */
const MIGRATION_LOCK_KEY = 8_147_236_915_002_771n;

export interface TenantMigrationResult {
  from: string | null;
  to: string;
  ran: boolean;
}

async function readVersion(client: pg.PoolClient): Promise<string | null> {
  try {
    const result = await client.query<{ value: { version?: string } }>(
      "select value from platform_sync where key = 'commerce_schema_version' limit 1",
    );
    return result.rows[0]?.value?.version ?? null;
  } catch {
    // `platform_sync` is created by company provisioning; a brand-new or
    // hand-made database may not have it yet.
    return null;
  }
}

async function writeVersion(client: pg.PoolClient, version: string): Promise<void> {
  await client.query(`
    create table if not exists platform_sync (
      id        uuid primary key default gen_random_uuid(),
      key       varchar(64) not null,
      value     jsonb       not null,
      synced_at timestamptz not null default now()
    )
  `);
  await client.query('create unique index if not exists platform_sync_key_key on platform_sync (key)');
  await client.query(
    `insert into platform_sync (key, value) values ('commerce_schema_version', $1::jsonb)
     on conflict (key) do update set value = excluded.value, synced_at = now()`,
    [JSON.stringify({ version, appliedAt: new Date().toISOString() })],
  );
}

/**
 * Brings one tenant database up to the current commerce schema.
 *
 * Drizzle's migrator owns the real bookkeeping (`__drizzle_migrations`), so this
 * is idempotent and resumable: each migration runs in its own transaction, and a
 * failure leaves the tenant at the last good migration for the next attempt.
 * The advisory lock means concurrent first-requests queue instead of racing.
 */
export async function ensureTenantSchema(pool: pg.Pool, tenantRef: string): Promise<TenantMigrationResult> {
  const client = await pool.connect();

  try {
    // Blocks (does not fail) if another process is already migrating this tenant.
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()]);

    const from = await readVersion(client);
    if (from === COMMERCE_SCHEMA_VERSION) {
      return { from, to: COMMERCE_SCHEMA_VERSION, ran: false };
    }

    const started = Date.now();
    logger.info({ tenantRef, from: from ?? 'none' }, 'migrating tenant schema');

    await migrate(drizzle(pool), { migrationsFolder });
    await writeVersion(client, COMMERCE_SCHEMA_VERSION);

    logger.info(
      { tenantRef, from: from ?? 'none', to: COMMERCE_SCHEMA_VERSION, ms: Date.now() - started },
      'tenant schema migrated',
    );

    return { from, to: COMMERCE_SCHEMA_VERSION, ran: true };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY.toString()]).catch(() => undefined);
    client.release();
  }
}
