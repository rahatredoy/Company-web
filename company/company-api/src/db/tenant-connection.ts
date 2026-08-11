import pg from 'pg';
import { config } from '../config/index';

/**
 * A raw connection to the tenant database cluster.
 *
 * The control database is reached through Drizzle in `db/client`; this is the
 * other side — the per-tenant databases the company platform creates, seeds and
 * (for the store admin's credential) writes to directly. Drizzle is deliberately
 * not used here: there is one connection per operation, against a database whose
 * name is only known at runtime.
 *
 * Defaults to `postgres` because the first thing provisioning does is create a
 * database, which cannot be done from inside the database being created.
 */
export function tenantAdminConnection(database = 'postgres'): pg.Client {
  return new pg.Client({
    host: config.tenantDb.host,
    port: config.tenantDb.port,
    user: config.tenantDb.user,
    password: config.tenantDb.password,
    database,
    ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15_000,
    application_name: 'company-api-provisioning',
  });
}
