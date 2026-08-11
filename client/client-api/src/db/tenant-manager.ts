import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index';
import { AppError, ERROR_CODES } from '../lib/errors';
import { logger } from '../lib/logger';
import { isValidStoreSlug, tenantDatabaseName } from '../lib/utils';
import * as schema from './schema/index';
import { ensureTenantSchema } from './tenant-migrate';

export type TenantDb = NodePgDatabase<typeof schema>;

/** The handle inside `db.transaction(async (tx) => …)`. */
export type TenantTx = Parameters<Parameters<TenantDb['transaction']>[0]>[0];

/**
 * Accepts either a pooled handle or an open transaction, so a helper can be
 * called standalone or composed into a larger atomic unit without duplication.
 */
export type TenantExecutor = TenantDb | TenantTx;

interface TenantConnection {
  pool: pg.Pool;
  db: TenantDb;
  databaseName: string;
  lastUsedAt: number;
}

/**
 * One PostgreSQL database per tenant, reached through a small cache of pools.
 *
 * Connections are lazy and bounded: hundreds of tenants share one cluster, so a
 * pool is small (`TENANT_POOL_MAX`), only the most recently used tenants stay
 * resident (`TENANT_POOL_CACHE`), and idle pools are closed. Tenant identity is
 * never taken from a request body or query — see `plugins/tenant.ts`.
 */
class TenantDatabaseManager {
  private readonly connections = new Map<string, TenantConnection>();
  private sweeper: NodeJS.Timeout | null = null;

  /** Serialises concurrent first-requests for the same tenant onto one setup. */
  private readonly pending = new Map<string, Promise<TenantConnection>>();

  constructor() {
    this.sweeper = setInterval(() => void this.sweepIdle(), 60_000);
    this.sweeper.unref?.();
  }

  async get(tenantRef: string, slug: string): Promise<TenantDb> {
    const existing = this.connections.get(tenantRef);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.db;
    }

    const inFlight = this.pending.get(tenantRef);
    if (inFlight) return (await inFlight).db;

    const setup = this.connect(tenantRef, slug).finally(() => this.pending.delete(tenantRef));
    this.pending.set(tenantRef, setup);

    const connection = await setup;
    return connection.db;
  }

  private async connect(tenantRef: string, slug: string): Promise<TenantConnection> {
    if (!isValidStoreSlug(slug)) {
      // The slug becomes part of a database identifier — never interpolate an
      // unvalidated value, even though it arrived from the company API.
      throw new AppError(ERROR_CODES.STORE_NOT_FOUND, 'Unknown store.', 404);
    }

    const databaseName = tenantDatabaseName(slug, config.tenantDb.namePrefix);

    const pool = new pg.Pool({
      host: config.tenantDb.host,
      port: config.tenantDb.port,
      user: config.tenantDb.user,
      password: config.tenantDb.password,
      database: databaseName,
      ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
      max: config.tenantDb.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: `client-api:${tenantRef}`,
    });

    pool.on('error', (error) => {
      logger.error({ tenantRef, err: error.message }, 'tenant pool idle client error');
    });

    try {
      // Fail fast with a clear error rather than a driver stack trace.
      await pool.query('select 1');
    } catch (error) {
      await pool.end().catch(() => undefined);
      const message = (error as Error).message;
      logger.error({ tenantRef, databaseName, err: message }, 'cannot reach tenant database');

      if (/does not exist/i.test(message)) {
        throw new AppError(
          ERROR_CODES.STORE_NOT_READY,
          'Your store database has not been created yet. If this persists, contact support.',
          503,
        );
      }
      throw new AppError(ERROR_CODES.TENANT_UNAVAILABLE, 'The store database is unavailable.', 503);
    }

    // Brings a brand-new tenant (or one behind a deploy) up to the current
    // schema. Guarded by an advisory lock, so concurrent boots are safe.
    await ensureTenantSchema(pool, tenantRef);

    const connection: TenantConnection = {
      pool,
      db: drizzle(pool, { schema, casing: 'snake_case' }),
      databaseName,
      lastUsedAt: Date.now(),
    };

    // Reconciles the company's provisioning vocabulary with ours and fills in
    // the rows every store is assumed to have. Imported lazily to keep the
    // module graph acyclic — the seeder needs `TenantDb` from this file.
    const { ensureStoreSeed } = await import('../services/store-seed');
    await ensureStoreSeed(connection.db, tenantRef);

    this.connections.set(tenantRef, connection);
    await this.evictOverflow();

    logger.info({ tenantRef, databaseName, resident: this.connections.size }, 'tenant pool opened');
    return connection;
  }

  /** Closes the least recently used pools once the cache is over capacity. */
  private async evictOverflow(): Promise<void> {
    const overflow = this.connections.size - config.tenantDb.poolCache;
    if (overflow <= 0) return;

    const oldest = [...this.connections.entries()]
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
      .slice(0, overflow);

    for (const [tenantRef] of oldest) await this.evict(tenantRef);
  }

  private async sweepIdle(): Promise<void> {
    const cutoff = Date.now() - config.tenantDb.poolIdleMinutes * 60_000;
    for (const [tenantRef, connection] of this.connections) {
      if (connection.lastUsedAt < cutoff) await this.evict(tenantRef);
    }
  }

  async evict(tenantRef: string): Promise<void> {
    const connection = this.connections.get(tenantRef);
    if (!connection) return;
    this.connections.delete(tenantRef);
    await connection.pool.end().catch(() => undefined);
    logger.debug({ tenantRef, resident: this.connections.size }, 'tenant pool closed');
  }

  /** Direct pool access for migrations and raw ledger SQL. */
  poolFor(tenantRef: string): pg.Pool | null {
    return this.connections.get(tenantRef)?.pool ?? null;
  }

  get residentCount(): number {
    return this.connections.size;
  }

  async closeAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    await Promise.all([...this.connections.keys()].map((ref) => this.evict(ref)));
  }
}

export const tenantDb = new TenantDatabaseManager();

/** Opens a short-lived connection to a tenant database outside the cache (CLI use). */
export function openTenantPool(slug: string): pg.Pool {
  return new pg.Pool({
    host: config.tenantDb.host,
    port: config.tenantDb.port,
    user: config.tenantDb.user,
    password: config.tenantDb.password,
    database: tenantDatabaseName(slug, config.tenantDb.namePrefix),
    ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
    max: 2,
    connectionTimeoutMillis: 10_000,
    application_name: 'client-api:migrate',
  });
}
