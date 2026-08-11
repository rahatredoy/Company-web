import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { config, isProduction } from './config/index';
import { logger } from './lib/logger';
import requestContext from './plugins/request-context';
import errorHandler from './plugins/error-handler';
import security from './plugins/security';
import tenant from './plugins/tenant';
import auth from './plugins/auth';
import healthRoutes from './modules/health/routes';
import authRoutes from './modules/auth/routes';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    disableRequestLogging: false,
    bodyLimit: 2 * 1024 * 1024,
    // The store slug arrives in the Host header, so it must survive routing.
    caseSensitive: false,
    ignoreTrailingSlash: true,
    // A proxy-supplied id is honoured so one trace spans the panel and the API;
    // otherwise every request still gets one, because it is echoed in error
    // bodies and is how a user-reported failure is found in the logs.
    genReqId: (request) => {
      const forwarded = request.headers['x-request-id'];
      return typeof forwarded === 'string' && forwarded.length <= 64 ? forwarded : randomUUID();
    },
  });

  await app.register(requestContext);
  await app.register(errorHandler);
  await app.register(security);

  // Health must be reachable without a store, so it is registered before the
  // tenant hook's own exemption list is ever consulted.
  await app.register(healthRoutes);

  // Order matters: `tenant` puts `request.store` in place, and `auth` reads it.
  await app.register(tenant);
  await app.register(auth);

  await app.register(
    async (instance) => {
      await instance.register(authRoutes);
    },
    { prefix: '/api/v1/admin' },
  );

  if (!isProduction) {
    app.log.info(
      {
        port: config.api.port,
        devStoreSlug: config.devStoreSlug,
        companyApi: config.company.apiUrl,
      },
      'client-api configured',
    );
  }

  return app;
}
