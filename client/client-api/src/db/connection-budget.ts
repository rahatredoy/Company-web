import pg from 'pg';
import { config, type TenantShard } from '../config/index';
import { logger } from '../lib/logger';

/**
 * Checks, at boot, that this instance cannot ask a shard for more connections
 * than the shard will give.
 *
 * The tenant pool cache is bounded by count, not by connections: up to
 * `TENANT_POOL_CACHE` tenants stay resident, each holding a pool of up to
 * `TENANT_POOL_MAX`. So one instance can hold `cache × max` connections open —
 * and every one of them lands on whichever shard those tenants happen to live
 * on. Nothing in the pool manager knows what a shard's `max_connections` is, so
 * the ceiling is only discovered under load, as `too many clients already` on
 * whichever store was unlucky enough to arrive last.
 *
 * `TENANT_SHARDS[].capacity` does not help: it counts *stores*, and a store
 * count says nothing about connections. A shard advertising room for 200 stores
 * behind a server with `max_connections = 100` is a promise it cannot keep.
 *
 * This runs once, reads `pg_settings`, and says so plainly. It never blocks
 * start-up: a shard that is briefly unreachable must not stop the API from
 * serving the shards that are up.
 */

interface ShardBudget {
  shard: string;
  maxConnections: number;
  reserved: number;
  usable: number;
  /** What this instance alone could demand of this shard in the worst case. */
  worstCase: number;
  headroom: number;
}

async function readLimits(shard: TenantShard): Promise<{ max: number; reserved: number } | null> {
  const client = new pg.Client({
    host: shard.host,
    port: shard.port,
    user: shard.user,
    password: shard.password,
    database: 'postgres',
    ssl: shard.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8_000,
    application_name: 'client-api:connection-budget',
  });

  try {
    await client.connect();
    const { rows } = await client.query<{ name: string; setting: string }>(
      `select name, setting from pg_settings
       where name in ('max_connections', 'superuser_reserved_connections')`,
    );
    const settingOf = (name: string) => Number(rows.find((row) => row.name === name)?.setting ?? 0);
    return { max: settingOf('max_connections'), reserved: settingOf('superuser_reserved_connections') };
  } catch (error) {
    logger.warn(
      { shard: shard.id, err: (error as Error).message },
      'could not read connection limits for shard',
    );
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Reports the budget for every configured shard, and returns the ones this
 * instance could overrun on its own.
 */
export async function checkConnectionBudget(): Promise<ShardBudget[]> {
  const { poolCache, poolMax } = config.tenantDb;
  const worstCase = poolCache * poolMax;

  const budgets: ShardBudget[] = [];

  for (const shard of config.tenantDb.shards) {
    const limits = await readLimits(shard);
    if (!limits) continue;

    const usable = limits.max - limits.reserved;
    budgets.push({
      shard: shard.id,
      maxConnections: limits.max,
      reserved: limits.reserved,
      usable,
      worstCase,
      headroom: usable - worstCase,
    });
  }

  const oversubscribed = budgets.filter((budget) => budget.headroom < 0);

  if (oversubscribed.length) {
    logger.error(
      {
        poolCache,
        poolMax,
        worstCase,
        shards: oversubscribed.map((b) => ({
          shard: b.shard,
          usable: b.usable,
          short: -b.headroom,
        })),
        // The two ways out, so the log line is actionable on its own.
        remedy:
          `lower TENANT_POOL_CACHE × TENANT_POOL_MAX below the smallest usable figure, ` +
          `or raise max_connections on those servers`,
      },
      'tenant pools are oversubscribed: this instance alone can exhaust a shard',
    );
  } else if (budgets.length) {
    logger.info(
      {
        poolCache,
        poolMax,
        worstCase,
        shards: budgets.map((b) => ({ shard: b.shard, usable: b.usable, headroom: b.headroom })),
      },
      'tenant connection budget checked',
    );
  }

  return oversubscribed;
}
