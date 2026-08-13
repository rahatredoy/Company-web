import pg from 'pg';
import type { TenantShard } from '../config/index';

/**
 * A raw connection to one shard of the tenant database cluster.
 *
 * The control database is reached through Drizzle in `db/client`; this is the
 * other side — the per-tenant databases the company platform creates, seeds and
 * (for the store admin's credential) writes to directly. Drizzle is deliberately
 * not used here: there is one connection per operation, against a database whose
 * name — and now whose *server* — is only known at runtime.
 *
 * The shard is always passed in rather than defaulted. There is no longer one
 * tenant server to fall back to, and guessing would write a store's data onto
 * whichever server happened to be first in the list.
 *
 * `database` defaults to `postgres` because the first thing provisioning does is
 * create a database, which cannot be done from inside the database being created.
 */
export function tenantAdminConnection(shard: TenantShard, database = 'postgres'): pg.Client {
  return new pg.Client({
    host: shard.host,
    port: shard.port,
    user: shard.user,
    password: shard.password,
    database,
    ssl: shard.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15_000,
    application_name: 'company-api-provisioning',
  });
}
