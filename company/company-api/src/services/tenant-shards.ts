import { count, isNotNull, sql } from 'drizzle-orm';
import pg from 'pg';
import { LEGACY_SHARD_ID, config, type TenantShard } from '../config/index';
import { db } from '../db/client';
import { tenants } from '../db/schema/index';
import { AppError, ERROR_CODES } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Placing a store on a server, and finding it again afterwards.
 *
 * One PostgreSQL server cannot hold every tenant database, so the cluster is a
 * list of them and each store records which one it landed on. This module owns
 * both halves of that: choosing a shard when a store is provisioned, and turning
 * the recorded id back into a connection.
 *
 * The chosen id is the *only* part that travels — `client-api` receives it on
 * the internal tenant payload and resolves it against its own copy of the
 * registry. Hosts and passwords stay on each side, so the control plane cannot
 * point a store's traffic at a server the commerce API was not configured for.
 */
const byId = new Map(config.tenantDb.shards.map((shard) => [shard.id, shard]));

/** The shard a tenant row names, or the pre-sharding server when it names none. */
export function resolveShard(shardId: string | null | undefined): TenantShard {
  const id = shardId?.trim() || LEGACY_SHARD_ID;

  const shard = byId.get(id);
  if (shard) return shard;

  logger.error(
    { shardId: id, known: [...byId.keys()] },
    'tenant names a shard this API has no configuration for',
  );
  throw new AppError(
    ERROR_CODES.PROVISIONING_FAILED,
    'This store is on a database server this deployment is not configured for.',
    503,
  );
}

/**
 * Connection options for a shard, for the raw `pg` clients the command-line
 * tools build themselves rather than going through `tenantAdminConnection`.
 */
export function shardClientOptions(shard: TenantShard, database: string) {
  return {
    host: shard.host,
    port: shard.port,
    user: shard.user,
    password: shard.password,
    database,
    ssl: shard.ssl ? { rejectUnauthorized: false } : undefined,
  };
}

/** How many stores each shard currently holds. Un-provisioned drafts do not count. */
async function occupancy(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      shard: sql<string>`coalesce(${tenants.databaseShard}, ${LEGACY_SHARD_ID})`.as('shard'),
      total: count(),
    })
    .from(tenants)
    .where(isNotNull(tenants.databaseName))
    .groupBy(sql`1`);

  return new Map(rows.map((row) => [row.shard, Number(row.total)]));
}

/**
 * Picks the shard for a store about to be provisioned: the one with the most
 * room left, so the cluster fills evenly rather than packing one server until it
 * tips over.
 *
 * A shard at `capacity: 0` is never chosen. That is how a server is drained, and
 * it is what keeps the pre-sharding `legacy` shard serving what it already holds
 * without ever being given more.
 */
export async function pickShardForNewTenant(): Promise<TenantShard> {
  const counts = await occupancy();

  let best: { shard: TenantShard; free: number } | null = null;
  for (const shard of config.tenantDb.shards) {
    const free = shard.capacity - (counts.get(shard.id) ?? 0);
    if (free <= 0) continue;
    if (!best || free > best.free) best = { shard, free };
  }

  if (!best) {
    // Refusing here is the honest answer: provisioning onto a full server would
    // succeed now and fail everyone on it later.
    logger.error(
      { shards: config.tenantDb.shards.map((s) => ({ id: s.id, capacity: s.capacity, used: counts.get(s.id) ?? 0 })) },
      'no tenant database shard has capacity for a new store',
    );
    throw new AppError(
      ERROR_CODES.TENANT_CAPACITY_EXHAUSTED,
      'No database server has room for a new store. Add a shard to TENANT_SHARDS.',
      503,
    );
  }

  logger.info({ shard: best.shard.id, free: best.free }, 'placed new store on shard');
  return best.shard;
}

/**
 * Finds the shard holding a database by asking each one in turn.
 *
 * For the command-line tools, and for a tenant row written before the shard was
 * recorded on it. Never used to serve a request: the recorded shard is the only
 * acceptable answer there, and a search would happily connect to a copy left
 * behind on an old server by an interrupted move.
 */
export async function locateShard(databaseName: string): Promise<TenantShard | null> {
  // `legacy` last: after a move off it, both servers hold a database of that
  // name until the old one is dropped, and the live store is never the old one.
  const order = [
    ...config.tenantDb.shards.filter((shard) => shard.id !== LEGACY_SHARD_ID),
    ...config.tenantDb.shards.filter((shard) => shard.id === LEGACY_SHARD_ID),
  ];

  for (const shard of order) {
    const client = new pg.Client({
      host: shard.host,
      port: shard.port,
      user: shard.user,
      password: shard.password,
      database: 'postgres',
      ssl: shard.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10_000,
      application_name: 'company-api:locate-shard',
    });

    try {
      await client.connect();
      const found = await client.query('select 1 from pg_database where datname = $1', [databaseName]);
      if (found.rowCount) return shard;
    } catch (error) {
      // A shard that is down must not hide a database on a shard that is up.
      logger.warn({ shard: shard.id, err: (error as Error).message }, 'shard unreachable while locating');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return null;
}
