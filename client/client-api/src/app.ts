import { randomUUID } from 'node:crypto';
import { constants as zlibConstants } from 'node:zlib';
import compress from '@fastify/compress';
import etag from '@fastify/etag';
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
import catalogRoutes from './modules/catalog/routes';
import customerRoutes from './modules/customers/routes';
import fulfilmentRoutes from './modules/fulfilment/routes';
import inventoryRoutes from './modules/inventory/routes';
import marketingRoutes from './modules/marketing/routes';
import orderRoutes from './modules/orders/routes';
import adminReviewRoutes from './modules/reviews/routes';
import settingsRoutes from './modules/settings/routes';
import storefrontRoutes from './modules/storefront/routes';
import uploadRoutes from './modules/uploads/routes';
import websiteRoutes from './modules/website/routes';

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

  /*
   * Compression, before anything that produces a body.
   *
   * A product listing is 40-90 KB of JSON with a great deal of repetition —
   * every row carries the same key names — and gzip takes roughly 85% of that
   * off the wire. On a storefront the payload is the page, so this is the single
   * largest thing that can be done about bandwidth, and it costs the origin a
   * few hundred microseconds of CPU per response.
   *
   * Brotli is offered first because it beats gzip by another 15-20% on JSON and
   * every browser that matters has supported it for years; gzip remains for
   * everything else. Quality 4 rather than brotli's default 11 — 11 is tuned for
   * compressing a file once and serving it a million times, and spends ~100x the
   * CPU for a few percent on a response generated per request.
   *
   * `threshold` leaves small bodies alone: below about a kilobyte the framing
   * overhead cancels the saving out, and every `{ "data": null }` would burn CPU
   * to get bigger.
   */
  await app.register(compress, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
    brotliOptions: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 6 },
  });

  /*
   * ETags, so a repeat read costs headers instead of a body.
   *
   * The catalogue reads below are marked cacheable with a short browser window
   * and a longer shared one (`lib/public-cache.ts`); when the browser's window
   * lapses it revalidates, and an unchanged listing comes back as a 304 with no
   * payload at all. That is the difference between a returning shopper costing
   * 90 KB and costing 200 bytes.
   *
   * Weak etags: the body is hashed after compression negotiation, and a weak
   * comparison is what lets the gzip and brotli copies of one response share a
   * validator instead of each needing its own.
   */
  await app.register(etag, { weak: true });

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
      await instance.register(catalogRoutes);
      await instance.register(orderRoutes);
      await instance.register(customerRoutes);
      await instance.register(adminReviewRoutes);
      await instance.register(inventoryRoutes);
      await instance.register(fulfilmentRoutes);
      await instance.register(marketingRoutes);
      await instance.register(websiteRoutes);
      await instance.register(settingsRoutes);
      await instance.register(uploadRoutes);
    },
    { prefix: '/api/v1/admin' },
  );

  /*
   * The public surface. Registered as its own prefix rather than inside the
   * block above because the two are told apart by their path: `surfaceOf` in
   * `lib/urls.ts` reads anything that is not `/api/v1/admin` as the storefront,
   * and `plugins/security.ts` gives each surface its own allowed origins. A
   * storefront route registered under the admin prefix would silently inherit
   * the panel's CORS policy.
   */
  await app.register(storefrontRoutes, { prefix: '/api/v1/storefront' });

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
