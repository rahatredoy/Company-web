import { buildApp } from './app';
import { config } from './config/index';
import { checkConnectionBudget } from './db/connection-budget';
import { tenantDb } from './db/tenant-manager';
import { subscribeToInvalidations } from './lib/company-client';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';

async function main(): Promise<void> {
  const app = await buildApp();

  // Before listening: the in-process tenant cache must not start answering
  // requests with nothing listening for the control plane's invalidations.
  subscribeToInvalidations();

  await app.listen({ port: config.api.port, host: config.api.host });
  logger.info({ port: config.api.port, env: config.env }, 'client-api listening');

  // After listening, not before: a shard being slow to answer must not delay
  // the health check, and an oversubscribed pool is a warning about load still
  // to come rather than a reason to refuse the traffic already arriving.
  void checkConnectionBudget().catch((error: unknown) => {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'connection budget check failed',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // In-flight requests first, then the tenant pools they were using.
    await app.close().catch((error: unknown) => logger.error({ err: error }, 'server close failed'));
    await tenantDb.closeAll().catch(() => undefined);
    await closeRedis().catch(() => undefined);

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error.message, stack: error.stack }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.fatal(
    { err: error instanceof Error ? error.message : String(error) },
    'client-api failed to start',
  );
  process.exit(1);
});
