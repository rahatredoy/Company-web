import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config, isProduction } from '../config/index';
import { AppError, ERROR_CODES } from '../lib/errors';
import { redis } from '../lib/redis';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths that legitimately receive cross-origin, non-browser POSTs. */
const ORIGIN_EXEMPT_PREFIXES = ['/api/v1/webhooks', '/api/v1/internal', '/health'];

export default fp(async function security(app: FastifyInstance) {
  await app.register(helmet, {
    // This API serves JSON only; a page CSP would be meaningless here.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  });

  await app.register(cookie, {
    // Cookie values are opaque random tokens already; signing adds nothing.
    parseOptions: { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' },
  });

  await app.register(cors, {
    // Explicit allow-list only. A wildcard is invalid with credentials anyway.
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl, server-to-server, health checks
      if (config.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new AppError(ERROR_CODES.FORBIDDEN, 'Origin not allowed.', 403), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With', 'x-internal-key', 'x-signature', 'stripe-signature'],
    maxAge: 600,
  });

  // Coarse global limiter; per-route limits live alongside their handlers.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request: FastifyRequest) => {
      const forwarded = request.headers['x-forwarded-for'];
      return typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : request.ip;
    },
    errorResponseBuilder: () => ({
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests. Please try again later.',
    }),
  });

  /**
   * CSRF defence for cookie-authenticated writes: the request must come from a
   * known origin. SameSite=Lax already blocks most cross-site POSTs; this closes
   * the gap for clients that ignore it.
   */
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (ORIGIN_EXEMPT_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;

    const origin = request.headers.origin;
    const referer = request.headers.referer;

    // No Origin at all means a non-browser client, which carries no ambient cookies.
    if (!origin && !referer) return;

    const candidate = origin ?? (referer ? new URL(referer).origin : null);
    if (candidate && config.allowedOrigins.includes(candidate)) return;

    throw new AppError(ERROR_CODES.CSRF_FAILED, 'Request origin is not allowed.', 403);
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    // Nothing this API returns should ever be cached by a browser or proxy.
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });
});
