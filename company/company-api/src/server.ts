import { buildApp } from './app';
import { config } from './config/index';
import { logger } from './lib/logger';
import { closeDatabase, pingDatabase } from './db/client';
import { closeRedis, pingRedis } from './lib/redis';
import { checkMailCredentials } from './lib/mailer';
import { closeQueues } from './queues/index';

async function main(): Promise<void> {
  const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);

  // A missing database is fatal; Redis is degraded-but-serviceable (rate limits
  // fail open and jobs run inline).
  if (!database) {
    logger.fatal('cannot reach company_control_db — check COMPANY_DATABASE_URL and run `npm run db:bootstrap`');
    process.exit(1);
  }
  if (!redis) {
    logger.warn('redis is unreachable — rate limiting and background jobs will degrade');
  }

  // Non-blocking: a broken mail provider degrades sign-in, it does not stop the
  // API from serving everything else.
  void checkMailCredentials().catch(() => undefined);

  const app = await buildApp();

  await app.listen({ port: config.api.port, host: config.api.host });
  logger.info(
    { port: config.api.port, env: config.env, origins: config.allowedOrigins },
    'company-api listening',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);

    try {
      await app.close();
      await closeQueues();
      await closeRedis();
      await closeDatabase();
      clearTimeout(timer);
      process.exit(0);
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error.message }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'failed to start');
  process.exit(1);
});
