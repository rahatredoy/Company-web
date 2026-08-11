import Fastify from 'fastify';
import { config, isProduction } from './config/index';
import { logger } from './lib/logger';
import { pingDatabase } from './db/client';
import { pingRedis } from './lib/redis';
import securityPlugin from './plugins/security';
import requestContextPlugin from './plugins/request-context';
import errorHandlerPlugin from './plugins/error-handler';
import authPlugin from './plugins/auth';
import publicRoutes from './modules/public/routes';
import clientRoutes from './modules/client/index';
import adminRoutes from './modules/admin/index';
import webhookRoutes from './modules/webhooks/routes';
import internalRoutes from './modules/internal/routes';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB — this API never receives file uploads
    disableRequestLogging: false,
    ajv: { customOptions: { removeAdditional: 'all' } },
  });

  // Order matters: context (raw body) → security → errors → auth → routes.
  await app.register(requestContextPlugin);
  await app.register(securityPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  app.get('/health', async () => {
    const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
    return {
      status: database ? 'ok' : 'degraded',
      database,
      redis,
      env: config.env,
      uptime: Math.round(process.uptime()),
    };
  });

  await app.register(publicRoutes, { prefix: '/api/v1/public' });
  await app.register(clientRoutes, { prefix: '/api/v1/client' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(internalRoutes, { prefix: '/api/v1/internal' });

  if (!isProduction) {
    app.get('/api/v1/routes', async () => app.printRoutes({ commonPrefix: false }));
  }

  return app;
}
