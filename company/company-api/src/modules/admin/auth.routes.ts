import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { count, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { companyAdmin, companyAdminLoginAttempts } from '../../db/schema/index';
import { config } from '../../config/index';
import { AppError, ERROR_CODES, forbidden, unauthorized } from '../../lib/errors';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password';
import {
  OTP_MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  isOtpExpired,
  otpExpiry,
  resendWaitSeconds,
  verifyOtp,
} from '../../lib/otp';
import { emails } from '../../lib/mailer';
import { clientIp, ok, parseBody, userAgent } from '../../lib/http';
import { enforce, enforceDual } from '../../lib/rate-limit';
import {
  LOGIN_BACKOFF_MS,
  LOGIN_LOCK_MINUTES,
  LOGIN_LOCK_THRESHOLD,
  RATE_LIMITS,
} from '../../lib/constants';
import { addMinutes, maskEmail, sleep } from '../../lib/utils';
import {
  clearDeviceCookie,
  clearSessionCookie,
  createAdminSession,
  findAdminSession,
  findAdminSessionById,
  promoteAdminSession,
  readDeviceToken,
  registerOtpAttempt,
  replaceSessionOtp,
  readSessionToken,
  refreshAdminSessionAuth,
  revokeAdminSession,
  revokeAllAdminSessions,
  revokeUnverifiedAdminSessions,
  setDeviceCookie,
  setSessionCookie,
} from '../../lib/session';
import {
  forgetAllDevices,
  forgetDevice,
  isDeviceTrusted,
  refreshDevice,
  rememberDevice,
  trustedDeviceExpiry,
} from '../../lib/trusted-device';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { getGeneralSettings } from '../../lib/settings';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const otpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');

const otpVerifySchema = z.object({ code: otpCode });

const reauthSchema = z.object({
  password: z.string().min(1, 'Enter your password.'),
});

const adminPasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200)
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
  .refine((v) => /\d/.test(v), 'Include at least one number.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.');

async function logAttempt(email: string, ip: string, agent: string, successful: boolean, reason?: string) {
  await db
    .insert(companyAdminLoginAttempts)
    .values({ email, ipAddress: ip || null, userAgent: agent || null, successful, failureReason: reason ?? null })
    .catch(() => undefined);
}

/** There is exactly one row, so "the admin" needs no id. */
async function loadAdmin() {
  const rows = await db.select().from(companyAdmin).limit(1);
  return rows[0] ?? null;
}

type AdminRow = NonNullable<Awaited<ReturnType<typeof loadAdmin>>>;

/** Shared by `GET /me` and `GET /session` so the two can never drift. */
async function adminView(admin: AdminRow) {
  return {
    id: admin.id,
    email: admin.email,
    lastLoginAt: admin.lastLoginAt,
    lastLoginIp: admin.lastLoginIp,
    passwordChangedAt: admin.passwordChangedAt,
  };
}

/** Shared failure handling for password checks at both `/login` and `/reauth`. */
async function registerFailedPassword(admin: AdminRow): Promise<void> {
  const failures = admin.failedLoginCount + 1;
  await db
    .update(companyAdmin)
    .set({
      failedLoginCount: failures,
      lockedUntil: failures >= LOGIN_LOCK_THRESHOLD ? addMinutes(new Date(), LOGIN_LOCK_MINUTES) : null,
      updatedAt: new Date(),
    })
    .where(eq(companyAdmin.id, admin.id));
}

async function clearFailedPassword(adminId: string): Promise<void> {
  await db
    .update(companyAdmin)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(companyAdmin.id, adminId));
}

/** Stamps the successful sign-in, whichever of the two paths reached it. */
async function recordSignIn(request: FastifyRequest, admin: AdminRow): Promise<void> {
  await db
    .update(companyAdmin)
    .set({ lastLoginAt: new Date(), lastLoginIp: clientIp(request) || null })
    .where(eq(companyAdmin.id, admin.id));
}

export default async function adminAuthRoutes(app: FastifyInstance) {
  /**
   * Unguarded session probe. Never 401s and never slides expiry — it exists so
   * the sign-in page and the dashboard layout consult one authority and cannot
   * disagree about what a cookie means.
   */
  app.get('/session', async (request: FastifyRequest, reply) => {
    const admin = await loadAdmin();

    const resolve = async (token: string | null) => {
      if (!token) return null;
      const session = await findAdminSession(token);
      return session ?? null;
    };

    const full = await resolve(readSessionToken(request, 'admin'));
    const challenge = full ? null : await resolve(readSessionToken(request, 'adminOtp'));
    const session = full ?? challenge;

    if (!session || !admin || admin.id !== session.adminId || admin.status !== 'active') {
      return ok(reply, { state: 'anonymous' as const });
    }

    // A full-cookie session that has not cleared the passcode step is still a
    // challenge, which also carries over sessions issued before the split.
    if (!session.otpVerified) {
      return ok(reply, {
        state: 'otp_required' as const,
        email: admin.email,
        challengeExpiresAt: session.expiresAt,
        otpExpiresAt: session.otpExpiresAt,
      });
    }

    return ok(reply, {
      state: 'authenticated' as const,
      admin: await adminView(admin),
      reauthValidUntil: addMinutes(session.authenticatedAt, config.security.reauthWindowMinutes),
    });
  });

  app.post('/login', async (request, reply) => {
    const body = parseBody(loginSchema, request.body);
    await enforceDual(request, 'admin-login', RATE_LIMITS.adminLogin, body.email);

    const ip = clientIp(request);
    const agent = userAgent(request);
    const admin = await loadAdmin();

    // Email is compared against the single admin record; a mismatch is an
    // ordinary credential failure with the same message and timing.
    if (!admin || admin.email.toLowerCase() !== body.email) {
      await fakeVerify();
      await logAttempt(body.email, ip, agent, false, 'unknown_admin');
      throw unauthorized('Email or password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      await logAttempt(body.email, ip, agent, false, 'locked');
      throw new AppError(ERROR_CODES.ACCOUNT_LOCKED, 'Too many failed attempts. Try again shortly.', 423);
    }

    const delay = LOGIN_BACKOFF_MS[Math.min(admin.failedLoginCount, LOGIN_BACKOFF_MS.length - 1)] ?? 0;
    if (delay > 0) await sleep(delay);

    if (!(await verifyPassword(admin.passwordHash, body.password))) {
      await registerFailedPassword(admin);
      await logAttempt(body.email, ip, agent, false, 'bad_password');
      await recordAudit(request, {
        action: AUDIT_ACTIONS.ADMIN_LOGIN_FAILED,
        actorLabel: body.email,
        actorType: 'admin',
      });
      throw unauthorized('Email or password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (admin.status !== 'active') {
      await logAttempt(body.email, ip, agent, false, 'inactive');
      throw forbidden('This administrator account is not active.');
    }

    await clearFailedPassword(admin.id);
    await revokeUnverifiedAdminSessions(admin.id);

    /*
     * A browser that cleared the passcode inside the trust window does not have
     * to clear it again: the device token is a second secret this machine holds
     * and no other does, so password + token is still two things, and the code
     * would only be re-proving what the token already proves. Any browser
     * without a live token falls through to the challenge below.
     */
    const deviceToken = readDeviceToken(request, 'adminDevice');
    if (await isDeviceTrusted(admin.id, deviceToken)) {
      const session = await createAdminSession(request, admin.id, { otpVerified: true });
      setSessionCookie(reply, 'admin', session);
      clearSessionCookie(reply, 'adminOtp');
      // Slide the window and re-stamp the cookie, so a browser in daily use is
      // never sent back to the passcode.
      await refreshDevice(deviceToken!);
      setDeviceCookie(reply, 'adminDevice', deviceToken!, trustedDeviceExpiry());

      await recordSignIn(request, admin);
      await logAttempt(body.email, ip, agent, true, 'trusted_device');
      await recordAudit(request, {
        action: AUDIT_ACTIONS.ADMIN_LOGIN_TRUSTED_DEVICE,
        actorId: admin.id,
        actorLabel: admin.email,
      });

      return ok(reply, { otpRequired: false as const, expiresAt: session.expiresAt });
    }

    /*
     * The password alone never produces a usable session. A challenge is issued
     * instead, carrying a hashed passcode, and only the passcode step promotes
     * it — so a stolen password is not by itself a way in.
     */
    const code = generateOtp();
    const expiresAt = otpExpiry(config.security.otpTtlMinutes);
    const session = await createAdminSession(request, admin.id, {
      otpVerified: false,
      otpCodeHash: hashOtp(code),
      otpExpiresAt: expiresAt,
    });

    setSessionCookie(reply, 'adminOtp', session);
    clearSessionCookie(reply, 'admin');

    // Delivery is best-effort; a mail outage must not leave the caller unable
    // to retry, and the code can always be resent.
    await emails.signInCode(admin.email, code, config.security.otpTtlMinutes, ip).catch((error: unknown) => {
      request.log.error({ err: (error as Error).message }, 'sign-in code email failed');
    });

    await logAttempt(body.email, ip, agent, false, 'awaiting_otp');
    await recordAudit(request, {
      action: AUDIT_ACTIONS.ADMIN_OTP_SENT,
      actorId: admin.id,
      actorLabel: admin.email,
    });

    return ok(reply, {
      otpRequired: true as const,
      // The address is echoed back masked so the form can say where the code
      // went without publishing the full address to anyone watching.
      sentTo: maskEmail(admin.email),
      expiresAt,
    });
  });

  /**
   * Completes sign-in with the emailed passcode.
   *
   * Guarded by `requireAdminPartial`, so the code is checked against the very
   * challenge it was issued for — a passcode from one login attempt is simply
   * absent from any other session row.
   */
  app.post('/otp/verify', { preHandler: app.requireAdminPartial }, async (request, reply) => {
    await enforce(request, 'admin-otp', RATE_LIMITS.otpVerify, request.adminAuth!.adminId);
    const { code } = parseBody(otpVerifySchema, request.body);

    const admin = await loadAdmin();
    if (!admin || admin.id !== request.adminAuth!.adminId) {
      throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    }

    const session = await findAdminSessionById(request.adminAuth!.sessionId);
    if (!session) throw unauthorized('Start again from the sign-in page.', ERROR_CODES.SESSION_EXPIRED);

    if (session.otpVerified) {
      // Already promoted — nothing to do, and re-verifying must not mint a
      // second code path into the account.
      return ok(reply, { verified: true as const });
    }

    if (isOtpExpired(session.otpExpiresAt)) {
      throw new AppError(ERROR_CODES.OTP_EXPIRED, 'That code has expired. Request a new one.', 401);
    }

    /*
     * Six digits is a million combinations, but a challenge that tolerated
     * unlimited guessing for its whole lifetime would still fall to a script.
     * The attempt cap is what makes the short code safe.
     */
    if (session.otpAttempts >= OTP_MAX_ATTEMPTS) {
      await revokeAdminSession(session.id);
      clearSessionCookie(reply, 'adminOtp');
      throw new AppError(
        ERROR_CODES.OTP_TOO_MANY_ATTEMPTS,
        'Too many incorrect codes. Sign in again.',
        429,
      );
    }

    if (!verifyOtp(session.otpCodeHash, code)) {
      const attempts = await registerOtpAttempt(session.id);
      await logAttempt(admin.email, clientIp(request), userAgent(request), false, 'bad_otp');

      if (attempts >= OTP_MAX_ATTEMPTS) {
        await revokeAdminSession(session.id);
        clearSessionCookie(reply, 'adminOtp');
        throw new AppError(
          ERROR_CODES.OTP_TOO_MANY_ATTEMPTS,
          'Too many incorrect codes. Sign in again.',
          429,
        );
      }

      throw new AppError(ERROR_CODES.OTP_INVALID, 'That code is not correct.', 401);
    }

    // Rotate the token on elevation, then move the cookie across.
    const promoted = await promoteAdminSession(session.id);
    clearSessionCookie(reply, 'adminOtp');
    setSessionCookie(reply, 'admin', promoted);

    // This browser has now proven the code, so remember it: the next sign-in
    // from here needs the password only, until the trust window lapses.
    const deviceToken = await rememberDevice(admin.id);
    if (deviceToken) {
      setDeviceCookie(reply, 'adminDevice', deviceToken, trustedDeviceExpiry());
      await recordAudit(request, {
        action: AUDIT_ACTIONS.ADMIN_DEVICE_TRUSTED,
        actorId: admin.id,
        actorLabel: admin.email,
      });
    }

    await recordSignIn(request, admin);
    await logAttempt(admin.email, clientIp(request), userAgent(request), true);
    await recordAudit(request, {
      action: AUDIT_ACTIONS.ADMIN_LOGIN,
      actorId: admin.id,
      actorLabel: admin.email,
    });

    return ok(reply, { verified: true as const });
  });

  /** Issues a fresh passcode against the same challenge. */
  app.post('/otp/resend', { preHandler: app.requireAdminPartial }, async (request, reply) => {
    await enforce(request, 'admin-otp-resend', RATE_LIMITS.otpResend, request.adminAuth!.adminId);

    const admin = await loadAdmin();
    if (!admin || admin.id !== request.adminAuth!.adminId) {
      throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    }

    const session = await findAdminSessionById(request.adminAuth!.sessionId);
    if (!session || session.otpVerified) {
      throw unauthorized('Start again from the sign-in page.', ERROR_CODES.SESSION_EXPIRED);
    }

    // A cooldown on top of the rate limit, so the endpoint cannot be used to
    // flood somebody's inbox even within an allowed budget.
    const wait = resendWaitSeconds(session.otpSentAt);
    if (wait > 0) {
      throw new AppError(
        ERROR_CODES.OTP_RESEND_TOO_SOON,
        `Wait ${wait} more second${wait === 1 ? '' : 's'} before requesting another code.`,
        429,
      );
    }

    const code = generateOtp();
    const expiresAt = otpExpiry(config.security.otpTtlMinutes);
    await replaceSessionOtp(session.id, hashOtp(code), expiresAt);

    await emails
      .signInCode(admin.email, code, config.security.otpTtlMinutes, clientIp(request))
      .catch((error: unknown) => {
        request.log.error({ err: (error as Error).message }, 'sign-in code resend failed');
      });

    return ok(reply, { sentTo: maskEmail(admin.email), expiresAt });
  });

  app.post('/logout', async (request, reply) => {
    // Signing out ends the session but deliberately leaves the browser
    // remembered — coming straight back should cost a password, not a new code.
    // `forgetDevice` is the opt-out, for signing out of a machine for good.
    const { forgetDevice: forget } = parseBody(
      z.object({ forgetDevice: z.boolean().optional() }),
      request.body ?? {},
    );

    const token = readSessionToken(request, 'admin') ?? readSessionToken(request, 'adminOtp');
    if (token) {
      const session = await findAdminSession(token);
      if (session) {
        await revokeAdminSession(session.id);
        if (forget) await forgetDevice(session.adminId, readDeviceToken(request, 'adminDevice'));
        await recordAudit(request, { action: AUDIT_ACTIONS.ADMIN_LOGOUT, actorId: session.adminId });
      }
    }
    // Clear both unconditionally — this doubles as "cancel the passcode challenge".
    clearSessionCookie(reply, 'admin');
    clearSessionCookie(reply, 'adminOtp');
    if (forget) clearDeviceCookie(reply, 'adminDevice');
    return ok(reply, { signedOut: true });
  });

  /**
   * Re-confirm identity so `requireAdminReauth` passes again. Without this the
   * re-auth guard is a one-way door: after the window lapses every destructive
   * action fails with no way back short of signing out.
   */
  app.post('/reauth', { preHandler: app.requireAdmin }, async (request, reply) => {
    await enforce(request, 'admin-reauth', RATE_LIMITS.reauth, request.adminAuth!.adminId);
    const body = parseBody(reauthSchema, request.body);

    const admin = await loadAdmin();
    if (!admin || admin.id !== request.adminAuth!.adminId) {
      throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new AppError(ERROR_CODES.ACCOUNT_LOCKED, 'Too many failed attempts. Try again shortly.', 423);
    }

    // Shares the failure counter with /login deliberately: brute forcing from a
    // live session should lock the front door too.
    const delay = LOGIN_BACKOFF_MS[Math.min(admin.failedLoginCount, LOGIN_BACKOFF_MS.length - 1)] ?? 0;
    if (delay > 0) await sleep(delay);

    if (!(await verifyPassword(admin.passwordHash, body.password))) {
      await registerFailedPassword(admin);
      await logAttempt(admin.email, clientIp(request), userAgent(request), false, 'bad_reauth_password');
      throw unauthorized('Your password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    await refreshAdminSessionAuth(request.adminAuth!.sessionId);
    await clearFailedPassword(admin.id);
    await logAttempt(admin.email, clientIp(request), userAgent(request), true, 'reauth');
    await recordAudit(request, {
      action: AUDIT_ACTIONS.ADMIN_REAUTH,
      actorId: admin.id,
      actorLabel: admin.email,
    });

    const now = new Date();
    return ok(reply, {
      reauthenticatedAt: now,
      validUntil: addMinutes(now, config.security.reauthWindowMinutes),
    });
  });

  app.get('/me', { preHandler: app.requireAdmin }, async (request, reply) => {
    const admin = await loadAdmin();
    if (!admin) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);
    return ok(reply, await adminView(admin));
  });

  app.post('/password', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseBody(
      z.object({
        currentPassword: z.string().min(1, 'Enter your current password.'),
        newPassword: adminPasswordSchema,
      }),
      request.body,
    );

    const admin = await loadAdmin();
    if (!admin) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);

    if (!(await verifyPassword(admin.passwordHash, body.currentPassword))) {
      throw unauthorized('Your current password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const now = new Date();
    await db
      .update(companyAdmin)
      .set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: now, updatedAt: now })
      .where(eq(companyAdmin.id, admin.id));

    await revokeAllAdminSessions(admin.id, request.adminAuth!.sessionId);
    // The password was just proven — no point demanding it again immediately.
    await refreshAdminSessionAuth(request.adminAuth!.sessionId);

    /*
     * Every other browser is signed out, so none of them may keep skipping the
     * passcode either — a device remembered under the old password would
     * otherwise walk back in on the new one with one factor. This browser is
     * re-trusted straight away: it is the one that just proved both.
     */
    await forgetAllDevices(admin.id);
    const deviceToken = await rememberDevice(admin.id);
    if (deviceToken) setDeviceCookie(reply, 'adminDevice', deviceToken, trustedDeviceExpiry());
    else clearDeviceCookie(reply, 'adminDevice');

    await recordAudit(request, {
      action: AUDIT_ACTIONS.ADMIN_PASSWORD_CHANGED,
      actorId: admin.id,
      actorLabel: admin.email,
    });

    return ok(reply, { updated: true });
  });
}
