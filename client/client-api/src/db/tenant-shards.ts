import pg from 'pg';
import { LEGACY_SHARD_ID, config, type TenantShard } from '../config/index';
import { AppError, ERROR_CODES } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Turning a shard **id** into a connection.
 *
 * The control plane decides which server a store's database lives on and
 * publishes that decision as an id on the tenant record. Credentials for the id
 * are read from this API's own configuration and never travel between the two
 * platforms — the same reason the database *name* is derived here rather than
 * transmitted. An id this API cannot resolve is a deployment that is behind on
 * configuration, not something a request can provoke.
 */
const byId = new Map(config.tenantDb.shards.map((shard) => [shard.id, shard]));

export function resolveShard(shardId: string | null | undefined): TenantShard {
  // A tenant provisioned before the cluster was sharded names no shard, and is
  // on the server that was the whole cluster at the time.
  const id = shardId?.trim() || LEGACY_SHARD_ID;

  const shard = byId.get(id);
  if (shard) return shard;

  logger.error(
    { shardId: id, known: [...byId.keys()] },
    'tenant names a shard this API has no configuration for',
  );
  throw new AppError(ERROR_CODES.TENANT_UNAVAILABLE, 'The store database is unavailable.', 503);
}

export function shardList(): TenantShard[] {
  return config.tenantDb.shards;
}

/**
 * Last-resort search for the shard holding a database, by asking each one.
 *
 * Only for a store the control plane cannot answer for — its recorded shard is
 * the authority everywhere else, because a move leaves the old database in place
 * until someone drops it and a search cannot tell the copy from the original.
 *
 * `legacy` is tried last for exactly that reason: after a move off it, both
 * servers hold a database of that name and the live one is never the old one.
 */
const located = new Map<string, TenantShard>();

export async function locateShard(databaseName: string): Promise<TenantShard | null> {
  const cached = located.get(databaseName);
  if (cached) return cached;

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
      application_name: 'client-api:locate-shard',
    });

    try {
      await client.connect();
      const found = await client.query('select 1 from pg_database where datname = $1', [databaseName]);
      if (found.rowCount) {
        located.set(databaseName, shard);
        return shard;
      }
    } catch (error) {
      // A shard that is down must not hide a database on a shard that is up.
      logger.warn({ shard: shard.id, err: (error as Error).message }, 'shard unreachable while locating');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return null;
}
