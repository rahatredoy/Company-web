import type { FastifyInstance } from 'fastify';
import { config } from '../../config/index';
import { tenantDb } from '../../db/tenant-manager';
import { ok } from '../../lib/http';
import { pingRedis } from '../../lib/redis';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness: is the process up? Never touches a dependency. */
  app.get('/health', async (_request, reply) => ok(reply, { status: 'ok', service: 'client-api' }));

  /**
   * Readiness: should this instance receive traffic? Reports the tenant pool
   * count rather than opening one — probing a tenant database here would let a
   * health check migrate a store.
   */
  app.get('/health/ready', async (_request, reply) => {
    const [redisOk, companyOk] = await Promise.all([
      pingRedis(),
      fetch(`${config.company.apiUrl}/health`, { signal: AbortSignal.timeout(3_000) })
        .then((response) => response.ok)
        .catch(() => false),
    ]);

    const ready = redisOk && companyOk;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      checks: { redis: redisOk, companyApi: companyOk },
      tenantPools: tenantDb.residentCount,
    });
  });
}
