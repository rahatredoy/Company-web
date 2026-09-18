import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config/index';
import { AppError, ERROR_CODES } from '../lib/errors';

/**
 * Plaintext HTTP is refused. Everything this API serves travels over TLS.
 *
 * In a normal deployment TLS is terminated at the edge and this hook never
 * fires: the proxy answers `:80` with a redirect of its own and forwards only
 * `https`. It is here for the case that arrangement is wrong — a load balancer
 * listener added without a redirect, a container port published straight to the
 * internet, a proxy rule that stopped matching — because the failure mode of
 * that mistake is silent. The API would keep answering, and every session
 * cookie, admin password and customer address would cross the wire in the clear
 * with nothing in the logs to say so.
 *
 * **`x-forwarded-proto` is what is read**, which is only trustworthy because the
 * header is set by the edge and `trustProxy` is on — the same assumption
 * `request.ip` already rests on for rate limiting. A deployment whose proxy does
 * not set it must set `FORCE_HTTPS=false` and enforce this at the edge instead;
 * leaving it on with a silent proxy would refuse every request, which is loud
 * and therefore the safe direction to fail.
 *
 * Two answers, and the difference matters:
 *
 * - **A safe method is redirected** (308, which preserves the method — a 301
 *   would let an intermediary turn it into a GET). Nothing has been read from
 *   the request yet, and a browser that arrived by typing a bare hostname
 *   deserves to land on the page.
 * - **Anything else is refused.** A redirect invites the client to replay the
 *   request, and by the time a POST arrives its body and its `Cookie` header
 *   have already crossed the network in the clear. The credential is spent;
 *   sending it again over TLS does not un-send the first copy. A 403 is what
 *   makes the deployment mistake visible instead of papering over it.
 *
 * `/health` is exempt for the reason it is exempt from the rate limiter: a load
 * balancer probes it over plain http on the instance's own address, before any
 * TLS listener is involved, and a liveness check that fails on transport takes
 * healthy instances out of rotation.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Paths probed over plain http from inside the network. */
const EXEMPT_PREFIXES = ['/health'];

/**
 * `Host` is attacker-supplied, and it is echoed into `Location` below. Anything
 * that is not a plain `hostname[:port]` is refused rather than redirected —
 * building a URL out of it is how a redirector becomes an open one.
 */
const HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i;

/** Whether the request reached this process over TLS, edge included. */
export function isSecureRequest(request: FastifyRequest): boolean {
  // Fastify resolves this from `x-forwarded-proto` when trustProxy is on, and
  // falls back to the socket, which covers TLS terminated by Node itself.
  return request.protocol === 'https';
}

export default fp(async function https(app: FastifyInstance) {
  if (!config.security.forceHttps) {
    /*
     * Loud only when it is dangerous. In development this is the expected
     * state and saying so on every boot is how a warning stops being read;
     * in production it means somebody turned the enforcement off, which is
     * either a deliberate "the edge handles it" or the mistake this whole
     * plugin exists to catch, and either way it belongs in the log.
     */
    if (isProduction) {
      app.log.warn(
        'FORCE_HTTPS is off in production — plaintext HTTP will be served unless the edge refuses it.',
      );
    } else {
      app.log.debug('FORCE_HTTPS is off — serving plaintext HTTP, which is what development is.');
    }
    return;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (isSecureRequest(request)) return;
    if (EXEMPT_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;

    const host = request.headers['x-forwarded-host'] ?? request.headers.host;
    const target = typeof host === 'string' && HOST_RE.test(host) ? host : null;

    if (SAFE_METHODS.has(request.method) && target) {
      /*
       * 307, and the two alternatives are both wrong.
       *
       * 301 lets an intermediary rewrite the method, which is how a redirect
       * quietly turns something else into a GET. 308 fixes that but is
       * *permanent* and therefore cached: a proxy that mislabels its own https
       * traffic as http would pin an infinite redirect into every visitor's
       * browser, and fixing the proxy would not un-pin it.
       *
       * Nothing is lost by making it temporary, because the browser is not
       * meant to learn the upgrade from here. `Strict-Transport-Security` is
       * what does that — two years, includeSubDomains, preload — and it is a
       * far stronger promise than a cached redirect: it upgrades the request
       * before it is sent, rather than after it has already been sent in the
       * clear once.
       */
      return reply.redirect(`https://${target}${request.url}`, 307);
    }

    request.log.warn(
      { method: request.method, host: target, url: request.url },
      'refused a plaintext HTTP request — check the TLS termination in front of this API',
    );

    throw new AppError(
      ERROR_CODES.HTTPS_REQUIRED,
      'This API is served over HTTPS only. Retry over https:// with fresh credentials.',
      403,
    );
  });
});
