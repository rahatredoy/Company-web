import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/**
 * Gives every request a stable id that is echoed in the response header and in
 * every error body, so a user-reported failure can be found in the logs.
 */
export default fp(async function requestContext(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', String(request.id));
  });

  // Raw body is needed byte-for-byte to verify webhook signatures.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body: string, done) => {
      request.rawBody = body;
      if (!body || body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(body));
      } catch {
        done(Object.assign(new Error('Malformed JSON body.'), { statusCode: 400 }), undefined);
      }
    },
  );
});

export function newRequestId(): string {
  return randomUUID();
}
