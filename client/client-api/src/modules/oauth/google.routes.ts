import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERROR_CODES } from '../../lib/errors';
import { parseQuery } from '../../lib/http';
import { logger } from '../../lib/logger';
import { exchangeGoogleCode, googleEnabled } from '../../lib/google-oauth';
import { consumeOAuthState, issueGoogleHandoff } from '../../lib/oauth-state';

/**
 * Where Google sends the browser back to, for every store on the platform.
 *
 * **This is the one route that has no tenant**, and it cannot have one: it is
 * reached on the API's own hostname, because Google matches redirect URIs
 * exactly and registering one per shop is not a thing that scales past the first
 * few. So it is listed in `plugins/tenant.ts`'s exempt prefixes alongside the
 * payment webhooks, and the store it belongs to is read out of the `state` this
 * API wrote itself.
 *
 * Nothing here touches a tenant database. The profile Google returned is parked
 * under a single-use hand-off code and the browser is sent back to the shop,
 * which spends that code against `POST /storefront/auth/google/exchange` — where
 * the hostname identifies the store again and the session cookie can be set on
 * the origin the shopper is actually standing on. Trying to sign them in here
 * would mean setting a cookie for a domain this response is not served from,
 * which browsers correctly refuse.
 */

const callbackSchema = z.object({
  code: z.string().trim().min(1).max(2048).optional(),
  state: z.string().trim().min(1).max(200),
  /** Google's own word for what went wrong; `access_denied` when the shopper said no. */
  error: z.string().trim().max(120).optional(),
});

export default async function googleOAuthRoutes(app: FastifyInstance) {
  app.get('/google/callback', async (request, reply) => {
    const query = parseQuery(callbackSchema, request.query);

    /*
     * The state is spent before anything else is looked at, so a replayed
     * callback fails here rather than further in. It is also the only thing
     * saying which store this belongs to — without it there is no shop to send
     * anyone back to, and redirecting somewhere derived from the query string
     * instead is exactly the open redirect this design exists to avoid.
     */
    const state = await consumeOAuthState(query.state);
    if (!state) {
      throw new AppError(
        ERROR_CODES.INVALID_TOKEN,
        'That sign-in link has expired. Please start again from the shop.',
        400,
      );
    }

    const back = (path: string): string => `${state.returnOrigin}${path}`;

    if (!googleEnabled()) return reply.redirect(back('/login?error=google'), 303);

    // The shopper pressed cancel, or Google refused. Either way it is a return
    // to the sign-in page and not an error screen on an API hostname.
    if (query.error || !query.code) {
      if (query.error && query.error !== 'access_denied') {
        logger.warn({ err: query.error, slug: state.slug }, 'google sign-in refused');
      }
      return reply.redirect(back('/login?error=google'), 303);
    }

    let code: string;
    try {
      const profile = await exchangeGoogleCode(query.code);
      code = await issueGoogleHandoff(state.tenantRef, profile);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), slug: state.slug },
        'google token exchange failed',
      );
      return reply.redirect(back('/login?error=google'), 303);
    }

    const next = new URLSearchParams({ code, next: state.next });
    return reply.redirect(back(`/auth/google/complete?${next.toString()}`), 303);
  });
}
