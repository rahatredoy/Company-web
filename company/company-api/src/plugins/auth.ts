import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { clientAccounts, companyAdmin } from '../db/schema/index';
import { config } from '../config/index';
import { AppError, ERROR_CODES, forbidden, unauthorized } from '../lib/errors';
import { safeEqual } from '../lib/crypto';
import {
  clearSessionCookie,
  findAdminSession,
  findClientSession,
  readSessionToken,
  setSessionCookie,
  touchAdminSession,
  touchClientSession,
} from '../lib/session';

declare module 'fastify' {
  interface FastifyInstance {
    requireClient: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    /** Client session that has passed credentials but not yet the passcode. */
    requireClientPartial: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    requireVerifiedClient: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    /** Admin session that has passed credentials but not yet the passcode. */
    requireAdminPartial: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    requireAdminReauth: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    requireInternalKey: (request: FastifyRequest) => Promise<void>;
  }
}

/**
 * How stale a session has to look before its cookie is written again. The row
 * slides forward on every request but the cookie cannot — a Set-Cookie on every
 * response is noise — so it is re-issued in steps instead.
 */
const COOKIE_REFRESH_AFTER_MINUTES = 5;

export default fp(async function auth(app: FastifyInstance) {
  /**
   * Credentials accepted, passcode not necessarily entered yet. Accepts either
   * cookie so the OTP step authenticates against the challenge it was issued for
   * — a code from one sign-in attempt is simply absent from any other row.
   */
  app.decorate('requireClientPartial', async (request: FastifyRequest, reply?: FastifyReply) => {
    // Both cookies are tried, not just the first one present: a dead session
    // cookie left in the browser must not shadow the live challenge cookie the
    // passcode step was issued under, or signing in again never completes.
    const candidates = (['client', 'clientOtp'] as const)
      .map((audience) => ({ audience, token: readSessionToken(request, audience) }))
      .filter((entry): entry is { audience: 'client' | 'clientOtp'; token: string } => entry.token !== null);

    if (candidates.length === 0) throw unauthorized('Sign in to continue.');

    let session: Awaited<ReturnType<typeof findClientSession>> = null;
    const dead: Array<'client' | 'clientOtp'> = [];
    for (const candidate of candidates) {
      session = await findClientSession(candidate.token);
      if (session) break;
      dead.push(candidate.audience);
    }

    /*
     * A cookie the API has just refused is worthless, so the browser is told to
     * drop it. Leaving it in place is what turns one expired session into an
     * endless trip round /dashboard → /sign-in: the guard on the way in only
     * sees that *a* cookie exists.
     */
    if (reply) for (const audience of dead) clearSessionCookie(reply, audience);

    if (!session) throw unauthorized('Your session has expired. Sign in again.', ERROR_CODES.SESSION_EXPIRED);

    const rows = await db
      .select({
        id: clientAccounts.id,
        email: clientAccounts.email,
        fullName: clientAccounts.fullName,
        status: clientAccounts.status,
        emailVerified: clientAccounts.emailVerified,
        onboardingCompleted: clientAccounts.onboardingCompleted,
      })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, session.clientAccountId))
      .limit(1);

    const account = rows[0];
    if (!account) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    if (account.status === 'suspended') {
      throw forbidden('This account is suspended. Contact support.', ERROR_CODES.ACCOUNT_SUSPENDED);
    }
    if (account.status === 'closed') throw unauthorized('This account is closed.');

    request.clientAuth = {
      accountId: account.id,
      email: account.email,
      fullName: account.fullName,
      sessionId: session.id,
      onboardingCompleted: account.onboardingCompleted,
      otpVerified: session.otpVerified,
      remember: session.remember,
      lastSeenAt: session.lastSeenAt,
    };
  });

  app.decorate('requireClient', async (request: FastifyRequest, reply?: FastifyReply) => {
    await app.requireClientPartial(request, reply);

    /*
     * The password alone never produces a usable session. Sessions issued before
     * the passcode step existed also land here, which signs them out once —
     * the honest outcome, rather than silently grandfathering single-factor
     * logins.
     */
    if (!request.clientAuth!.otpVerified) {
      throw new AppError(ERROR_CODES.OTP_REQUIRED, 'Enter the passcode we emailed you.', 401);
    }

    // Sliding expiry; "remember me" sessions were created with a longer window.
    const auth = request.clientAuth!;
    const slid = await touchClientSession(auth.sessionId, auth.remember);

    /*
     * The cookie has to slide with the record, and a JWT cannot be slid in
     * place: its expiry is signed into it, so `touch` mints a **new token** for
     * the same session and this writes that one back. Re-writing the cookie with
     * the string the browser already sent would move the cookie's expiry and
     * leave the token's where it was — someone working through the day would
     * still be signed out mid-task, and the bug would look like the refresh had
     * simply not run.
     *
     * Only every few minutes, though: a Set-Cookie on every response is noise.
     */
    const idleMinutes = (Date.now() - auth.lastSeenAt.getTime()) / 60_000;
    if (reply && slid && idleMinutes >= COOKIE_REFRESH_AFTER_MINUTES) {
      setSessionCookie(reply, 'client', { id: auth.sessionId, ...slid });
    }
  });

  app.decorate('requireVerifiedClient', async (request: FastifyRequest, reply?: FastifyReply) => {
    await app.requireClient(request, reply);
    const rows = await db
      .select({ emailVerified: clientAccounts.emailVerified })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, request.clientAuth!.accountId))
      .limit(1);

    if (!rows[0]?.emailVerified) {
      throw forbidden('Verify your email address to continue.', ERROR_CODES.EMAIL_NOT_VERIFIED);
    }
  });

  /**
   * Credentials accepted, passcode not necessarily entered yet. Accepts either
   * cookie so the OTP step can authenticate against the challenge it was issued.
   */
  app.decorate('requireAdminPartial', async (request: FastifyRequest, reply?: FastifyReply) => {
    // Same reasoning as the client guard: a dead session cookie must not hide
    // the live challenge cookie, and a refused cookie is told to go away.
    const candidates = (['admin', 'adminOtp'] as const)
      .map((audience) => ({ audience, token: readSessionToken(request, audience) }))
      .filter((entry): entry is { audience: 'admin' | 'adminOtp'; token: string } => entry.token !== null);

    if (candidates.length === 0) throw unauthorized('Sign in to continue.');

    let session: Awaited<ReturnType<typeof findAdminSession>> = null;
    const dead: Array<'admin' | 'adminOtp'> = [];
    for (const candidate of candidates) {
      session = await findAdminSession(candidate.token);
      if (session) break;
      dead.push(candidate.audience);
    }

    if (reply) for (const audience of dead) clearSessionCookie(reply, audience);

    if (!session) throw unauthorized('Your session has expired. Sign in again.', ERROR_CODES.SESSION_EXPIRED);

    const rows = await db
      .select({ id: companyAdmin.id, email: companyAdmin.email, status: companyAdmin.status })
      .from(companyAdmin)
      .where(eq(companyAdmin.id, session.adminId))
      .limit(1);

    const admin = rows[0];
    if (!admin) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    if (admin.status !== 'active') throw forbidden('This administrator account is not active.');

    request.adminAuth = {
      adminId: admin.id,
      email: admin.email,
      sessionId: session.id,
      otpVerified: session.otpVerified,
      authenticatedAt: session.authenticatedAt,
      lastSeenAt: session.lastSeenAt,
    };
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply?: FastifyReply) => {
    await app.requireAdminPartial(request, reply);
    if (!request.adminAuth!.otpVerified) {
      throw new AppError(ERROR_CODES.OTP_REQUIRED, 'Enter the passcode we emailed you.', 401);
    }
    /*
     * The admin cookie slides for the same reason the client one does, and it
     * matters more here than it did against a database row: the row could be
     * pushed forward on its own, but a JWT expires exactly when it was signed to
     * and would sign a working administrator out mid-task.
     */
    const auth = request.adminAuth!;
    const slid = await touchAdminSession(auth.sessionId);
    const idleMinutes = (Date.now() - auth.lastSeenAt.getTime()) / 60_000;
    if (reply && slid && idleMinutes >= COOKIE_REFRESH_AFTER_MINUTES) {
      setSessionCookie(reply, 'admin', { id: auth.sessionId, ...slid });
    }
  });

  /**
   * Sensitive actions require a recent proof of identity, so a stolen but idle
   * session cannot suspend clients or rewrite settings.
   */
  app.decorate('requireAdminReauth', async (request: FastifyRequest, reply?: FastifyReply) => {
    await app.requireAdmin(request, reply);
    const ageMinutes = (Date.now() - request.adminAuth!.authenticatedAt.getTime()) / 60_000;
    if (ageMinutes > config.security.reauthWindowMinutes) {
      throw new AppError(
        ERROR_CODES.REAUTH_REQUIRED,
        'Confirm your password to continue with this action.',
        401,
      );
    }
  });

  /** Shared-secret guard for the future client platform. */
  app.decorate('requireInternalKey', async (request: FastifyRequest) => {
    const provided = request.headers['x-internal-key'];
    if (typeof provided !== 'string' || !safeEqual(provided, config.security.internalApiKey)) {
      throw unauthorized('Invalid internal key.');
    }
  });
});
