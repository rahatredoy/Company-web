import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { loadStorefrontConfig } from '../../services/storefront-config';

/**
 * Everything the storefront shell needs, in one cached read.
 *
 * Called on every single page render, so it is one round trip and it is
 * cacheable — which is only true because there is nothing visitor-specific in
 * it. Adding a field that varies by shopper here would put one customer's data
 * into the next customer's page for the length of the TTL.
 */
export default async function configRoutes(app: FastifyInstance) {
  app.get('/config', async (request, reply) => {
    return ok(reply, await loadStorefrontConfig(storeOf(request)));
  });
}
