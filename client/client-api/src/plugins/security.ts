import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config, isProduction } from '../config/index';
import { AppError, ERROR_CODES } from '../lib/errors';
import { redis } from '../lib/redis';
import { fetchTenantByDomain, hostsForSurface } from '../lib/company-client';
import { allowedOriginsFor, surfaceOf, type Surface } from '../lib/urls';
import { slugFromHost } from '../lib/utils';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths that legitimately receive cross-origin, non-browser POSTs. */
const ORIGIN_EXEMPT_PREFIXES = ['/api/v1/webhooks', '/health'];

/**
 * A static allow-list is impossible here: every store has its own admin and
 * storefront origin, and custom domains are supported.
 *
 * So the origin is reduced to a slug and then **rebuilt** from the configured
 * URL patterns and compared exactly. A lookalike such as
 * `evil-abc-fashion.localhost` reduces to a different slug, rebuilds to a
 * different origin, and is refused. Nothing here trusts the Origin header as
 * evidence of identity — that is the tenant plugin's job, working from the
 * hostname the proxy resolved.
 *
 * The check is per **surface**, not per platform. Belonging to the same store is
 * not enough to call the admin API: a storefront renders owner-authored content
 * and is the softer of the two targets, so its origin is allowed the commerce
 * routes and refused the admin ones. Which surface a request is on comes from
 * its own path, never from anything the caller sends.
 */
export async function isAllowedOrigin(origin: string, surface: Surface): Promise<boolean> {
  let hostname: string;
  let normalised: string;
  try {
    const url = new URL(origin);
    hostname = url.host;
    normalised = url.origin;
  } catch {
    return false;
  }

  const slug = slugFromHost(hostname, config.urls.platformRootDomain);
  if (slug) return allowedOriginsFor(slug, surface).includes(normalised);

  // Bare `http://localhost:3002` during development, where the host carries no
  // slug label. Accepted only alongside DEV_STORE_SLUG, which is forced off in
  // production.
  if (!isProduction && config.devStoreSlug) {
    const devHosts = allowedOriginsFor(config.devStoreSlug, surface).map((allowed) => {
      const url = new URL(allowed);
      return `${url.protocol}//localhost${url.port ? `:${url.port}` : ''}`;
    });
    if (devHosts.includes(normalised)) return true;
  }

  /*
   * A connected custom domain — `https://abcfashion.com` for the storefront, or
   * `https://admin.abcfashion.com` for the panel. The allow-list cannot be
   * static or pattern-based here, so the hostname is looked up against the
   * company platform's verified-domain table (Redis-cached, with a negative
   * cache) and accepted only on an exact match *of the right type*. An
   * unverified domain resolves to nothing and is refused; a storefront domain
   * asking for the admin routes resolves to a store but not to this surface, and
   * is refused too.
   */
  const bare = hostname.split(':')[0]!.toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost') || !bare.includes('.')) return false;

  const tenant = await fetchTenantByDomain(bare).catch(() => null);
  if (!tenant) return false;

  return hostsForSurface(tenant, surface).includes(bare);
}

export default fp(async function security(app: FastifyInstance) {
  await app.register(helmet, {
    // This API serves JSON only; a page CSP would be meaningless here.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  });

  await app.register(cookie, {
    // Cookie values are opaque random tokens already; signing adds nothing.
    parseOptions: { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' },
  });

  /*
   * Registered as a delegator rather than with a static `origin` function,
   * because whether an origin is allowed depends on the route it is asking for:
   * the admin panel's origin and the storefront's origin are both valid for the
   * same store, but not for the same endpoints. A plain `origin(origin, cb)`
   * callback is never handed the request and cannot tell them apart.
   *
   * A preflight names its real target in `Access-Control-Request-*`, but its own
   * URL is already the endpoint being asked about, so `request.url` is the right
   * signal for both the preflight and the request that follows.
   */
  const CORS_BASE: FastifyCorsOptions = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'X-Requested-With',
      'X-Store-Slug',
      'X-Cart-Token',
      'x-signature',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };

  type CorsCallback = (error: Error | null, options: FastifyCorsOptions) => void;

  await app.register(cors, () => (request: FastifyRequest, callback: CorsCallback) => {
    const origin = request.headers.origin;
    // curl, server-to-server, health checks — no ambient cookies to protect.
    if (!origin) return callback(null, { ...CORS_BASE, origin: true });

    void isAllowedOrigin(origin, surfaceOf(request.url)).then(
      (allowed) =>
        allowed
          ? callback(null, { ...CORS_BASE, origin: true })
          : callback(new AppError(ERROR_CODES.FORBIDDEN, 'Origin not allowed.', 403), {
              ...CORS_BASE,
              origin: false,
            }),
      () =>
        callback(new AppError(ERROR_CODES.FORBIDDEN, 'Origin not allowed.', 403), {
          ...CORS_BASE,
          origin: false,
        }),
    );
  });

  /*
   * Coarse global limiter; the sensitive per-route limits live with their
   * handlers.
   *
   * Backed by Redis so the budget is shared across every process, which means
   * one network round trip per request — the single fixed cost on the path of
   * everything this API serves. `/health` is exempted for exactly that reason:
   * a load balancer probes it every few seconds per instance forever, it reads
   * nothing and reveals nothing, and making a liveness check depend on a remote
   * Redis inverts the dependency — a Redis blip would fail the probe and take
   * healthy instances out of rotation.
   */
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    redis,
    allowList: (request: FastifyRequest) => request.url.startsWith('/health'),
    keyGenerator: (request: FastifyRequest) => {
      const forwarded = request.headers['x-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : request.ip;
      // Scoped per store so one busy tenant cannot exhaust another's budget.
      return `${request.headers.host ?? '-'}:${ip}`;
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

    // Neither header means a non-browser client, which carries no ambient cookies.
    if (!origin && !referer) return;

    let candidate: string | null = origin ?? null;
    if (!candidate && referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        candidate = null;
      }
    }

    if (candidate && (await isAllowedOrigin(candidate, surfaceOf(request.url)))) return;

    throw new AppError(ERROR_CODES.CSRF_FAILED, 'Request origin is not allowed.', 403);
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // Authenticated JSON must never be cached. Public storefront reads set their
    // own Cache-Control and are left alone.
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
});
