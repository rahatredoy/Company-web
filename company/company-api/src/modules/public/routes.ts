import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  clientAccounts,
  clientEmailVerificationTokens,
  clientLoginAttempts,
  clientPasswordResetTokens,
  contactMessages,
  plans,
  tenants,
} from '../../db/schema/index';
import { config, isDevelopment } from '../../config/index';
import { AppError, ERROR_CODES, forbidden, unauthorized } from '../../lib/errors';
import { generateToken, sha256 } from '../../lib/crypto';
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
import { clientIp, ok, parseBody, parseQuery, userAgent } from '../../lib/http';
import { enforce, enforceDual, reset as resetRateLimit } from '../../lib/rate-limit';
import { RATE_LIMITS, LOGIN_BACKOFF_MS, LOGIN_LOCK_MINUTES, LOGIN_LOCK_THRESHOLD, TOKEN_TTL } from '../../lib/constants';
import { addMinutes, maskEmail, sleep, validateSubdomain } from '../../lib/utils';
import {
  createClientSession,
  clearSessionCookie,
  findClientSession,
  findClientSessionById,
  promoteClientSession,
  readSessionToken,
  registerClientOtpAttempt,
  replaceClientSessionOtp,
  revokeClientSession,
  revokeUnverifiedClientSessions,
  setSessionCookie,
} from '../../lib/session';
import { emails } from '../../lib/mailer';
import { getSettings } from '../../lib/settings';
import { recordActivity } from '../../lib/audit';
import { planPublicView } from '../../services/views';

const emailSchema = z.string().trim().toLowerCase().min(5).max(254).email('Enter a valid email address.');

const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Password is too long.')
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
  .refine((v) => /\d/.test(v), 'Include at least one number.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .min(6, 'Enter a valid phone number.')
    .max(24)
    .regex(/^\+?[0-9][0-9\s().-]{5,23}$/, 'Enter a valid phone number.'),
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: 'You must accept the terms to continue.' }),
  planCode: z.string().trim().max(40).optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean().default(false),
});

const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');

/**
 * Development convenience: with a real mail provider configured the passcode
 * only exists in an inbox, and `MAIL_DEV_REDIRECT_TO` may divert it somewhere
 * the developer is not watching. Never runs outside development.
 */
function logCodeInDevelopment(request: FastifyRequest, purpose: string, to: string, code: string): void {
  if (!isDevelopment) return;
  request.log.warn({ purpose, to, code }, 'development only: passcode issued');
}

async function logLoginAttempt(
  email: string,
  ip: string,
  agent: string,
  successful: boolean,
  failureReason?: string,
): Promise<void> {
  await db
    .insert(clientLoginAttempts)
    .values({ email, ipAddress: ip || null, userAgent: agent || null, successful, failureReason: failureReason ?? null })
    .catch(() => undefined);
}

/** The one live code for an account, if there is one. */
async function findLiveVerificationCode(clientAccountId: string) {
  const rows = await db
    .select()
    .from(clientEmailVerificationTokens)
    .where(
      and(
        eq(clientEmailVerificationTokens.clientAccountId, clientAccountId),
        isNull(clientEmailVerificationTokens.usedAt),
        gt(clientEmailVerificationTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(clientEmailVerificationTokens.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/** Marks a code used without verifying it — how a burned or replaced code dies. */
async function burnVerificationCode(id: string): Promise<void> {
  await db
    .update(clientEmailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(clientEmailVerificationTokens.id, id));
}

/**
 * Generates, stores and emails an activation passcode.
 *
 * Any earlier code is retired first, so an account never has two working codes
 * — a resend must invalidate what it replaces, or the attempt cap on the new
 * code means nothing.
 */
async function issueVerificationCode(
  request: FastifyRequest,
  account: { id: string; email: string; fullName: string },
): Promise<{ expiresAt: Date }> {
  await db
    .update(clientEmailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(clientEmailVerificationTokens.clientAccountId, account.id),
        isNull(clientEmailVerificationTokens.usedAt),
      ),
    );

  const code = generateOtp();
  const expiresAt = addMinutes(new Date(), TOKEN_TTL.emailVerificationMinutes);

  await db.insert(clientEmailVerificationTokens).values({
    clientAccountId: account.id,
    codeHash: hashOtp(code),
    expiresAt,
  });

  logCodeInDevelopment(request, 'email_verification', account.email, code);

  // Delivery is best-effort: a mail outage must not leave the caller staring at
  // an error with an account already created and no way to ask for another code.
  await emails
    .verificationCode(account.email, account.fullName, code, TOKEN_TTL.emailVerificationMinutes, account.id)
    .catch((error: unknown) => {
      request.log.error({ err: (error as Error).message }, 'verification code email failed');
    });

  return { expiresAt };
}

/** Slows repeated failures without ever telling the caller why. */
async function applyBackoff(failures: number): Promise<void> {
  const delay = LOGIN_BACKOFF_MS[Math.min(failures, LOGIN_BACKOFF_MS.length - 1)] ?? 0;
  if (delay > 0) await sleep(delay);
}

export default async function publicRoutes(app: FastifyInstance) {
  // --- Plans & settings ------------------------------------------------------

  app.get('/plans', async (_request, reply) => {
    const rows = await db
      .select()
      .from(plans)
      .where(eq(plans.status, 'active'))
      .orderBy(asc(plans.sortOrder), asc(plans.monthlyPrice));

    return ok(reply, rows.map(planPublicView));
  });

  app.get('/settings', async (_request, reply) => {
    const settings = await getSettings();
    return ok(reply, {
      platformName: settings.general.platformName,
      supportEmail: settings.general.supportEmail,
      supportPhone: settings.general.supportPhone,
      defaultCurrency: settings.general.defaultCurrency,
      trialDays: settings.trial.trialDays,
    });
  });

  // --- Subdomain availability -------------------------------------------------

  app.get('/subdomain/check', async (request, reply) => {
    await enforce(request, 'subdomain', RATE_LIMITS.subdomainCheck);

    const { value } = parseQuery(z.object({ value: z.string().trim().min(1).max(64) }), request.query);
    const check = validateSubdomain(value);
    if (!check.ok) {
      return ok(reply, { available: false, reason: check.message });
    }

    const taken = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, check.value))
      .limit(1);

    return taken[0]
      ? ok(reply, { available: false, reason: 'This address is already taken.' })
      : ok(reply, { available: true });
  });

  // --- Registration -----------------------------------------------------------

  app.post('/register', async (request, reply) => {
    const body = parseBody(registerSchema, request.body);
    await enforceDual(request, 'register', RATE_LIMITS.register, body.email);

    const existing = await db
      .select({ id: clientAccounts.id, emailVerified: clientAccounts.emailVerified })
      .from(clientAccounts)
      .where(eq(clientAccounts.email, body.email))
      .limit(1);

    if (existing[0]) {
      // Do not confirm that the address exists — tell the user to sign in instead.
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'That email cannot be used to register. Try signing in or resetting your password.',
        409,
      );
    }

    const passwordHash = await hashPassword(body.password);

    const [account] = await db
      .insert(clientAccounts)
      .values({
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        passwordHash,
        acceptedTermsAt: new Date(),
        intendedPlanCode: body.planCode ?? null,
        intendedBillingCycle: body.billingCycle ?? null,
      })
      .returning({ id: clientAccounts.id, email: clientAccounts.email, fullName: clientAccounts.fullName });

    const { expiresAt } = await issueVerificationCode(request, account!);

    await recordActivity({
      type: 'client_registered',
      title: 'New client registered',
      subject: account!.fullName,
      clientAccountId: account!.id,
    });

    // The account is inert until the code is entered, so the address is echoed
    // back in full: it is the one the caller just typed, and the verification
    // page needs it to submit the code against.
    return ok(reply, { registered: true, otpRequired: true as const, email: account!.email, expiresAt }, 201);
  });

  // --- Email verification -----------------------------------------------------

  /**
   * Activates the account with the emailed passcode, then signs the caller in.
   *
   * Entering the code proves the same two things a sign-in does — knowledge of
   * the password used moments ago and control of the inbox — so sending the new
   * customer back to a login form would be ceremony, not security.
   */
  app.post('/verify-email', async (request, reply) => {
    const body = parseBody(z.object({ email: emailSchema, code: otpCodeSchema }), request.body);
    await enforceDual(request, 'verify-email', RATE_LIMITS.verifyEmail, body.email);

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
      .where(eq(clientAccounts.email, body.email))
      .limit(1);

    const account = rows[0];

    // A wrong address and a wrong code are the same failure, so this endpoint
    // cannot be used to discover which addresses have accounts.
    const invalid = () => new AppError(ERROR_CODES.OTP_INVALID, 'That code is not correct or has expired.', 400);

    if (!account) throw invalid();
    if (account.status === 'suspended') {
      throw forbidden('This account is suspended. Contact support.', ERROR_CODES.ACCOUNT_SUSPENDED);
    }
    if (account.emailVerified) {
      throw new AppError(
        ERROR_CODES.EMAIL_ALREADY_VERIFIED,
        'This email is already verified. Sign in to continue.',
        409,
      );
    }

    const record = await findLiveVerificationCode(account.id);
    if (!record) throw invalid();

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await burnVerificationCode(record.id);
      throw new AppError(
        ERROR_CODES.OTP_TOO_MANY_ATTEMPTS,
        'Too many incorrect codes. Request a new one.',
        429,
      );
    }

    if (!verifyOtp(record.codeHash, body.code)) {
      const [updated] = await db
        .update(clientEmailVerificationTokens)
        .set({ attempts: sql`${clientEmailVerificationTokens.attempts} + 1` })
        .where(eq(clientEmailVerificationTokens.id, record.id))
        .returning({ attempts: clientEmailVerificationTokens.attempts });

      if ((updated?.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
        await burnVerificationCode(record.id);
        throw new AppError(
          ERROR_CODES.OTP_TOO_MANY_ATTEMPTS,
          'Too many incorrect codes. Request a new one.',
          429,
        );
      }

      throw invalid();
    }

    const now = new Date();
    await db
      .update(clientEmailVerificationTokens)
      .set({ usedAt: now })
      .where(eq(clientEmailVerificationTokens.id, record.id));

    await db
      .update(clientAccounts)
      .set({
        emailVerified: true,
        emailVerifiedAt: now,
        status: 'active',
        lastLoginAt: now,
        lastLoginIp: clientIp(request) || null,
        updatedAt: now,
      })
      .where(eq(clientAccounts.id, account.id));

    // Verified in one step, so the session starts fully authenticated.
    const session = await createClientSession(request, account.id, false, { otpVerified: true });
    setSessionCookie(reply, 'client', session);
    await logLoginAttempt(account.email, clientIp(request), userAgent(request), true, 'email_verified');

    return ok(reply, {
      verified: true,
      signedIn: true as const,
      onboardingCompleted: account.onboardingCompleted,
    });
  });

  app.post('/resend-verification', async (request, reply) => {
    const { email } = parseBody(z.object({ email: emailSchema }), request.body);
    await enforceDual(request, 'resend-verification', RATE_LIMITS.resendVerification, email);

    const rows = await db
      .select({
        id: clientAccounts.id,
        email: clientAccounts.email,
        fullName: clientAccounts.fullName,
        emailVerified: clientAccounts.emailVerified,
      })
      .from(clientAccounts)
      .where(eq(clientAccounts.email, email))
      .limit(1);

    const account = rows[0];

    // Always answer the same way so this cannot be used to enumerate accounts.
    if (account && !account.emailVerified) {
      const existing = await findLiveVerificationCode(account.id);
      const wait = resendWaitSeconds(existing?.sentAt);
      if (wait > 0) {
        throw new AppError(
          ERROR_CODES.OTP_RESEND_TOO_SOON,
          `Wait ${wait} more second${wait === 1 ? '' : 's'} before requesting another code.`,
          429,
        );
      }

      await issueVerificationCode(request, account);
    }

    return ok(reply, { sent: true });
  });

  // --- Login / logout ---------------------------------------------------------

  app.post('/login', async (request, reply) => {
    const body = parseBody(loginSchema, request.body);
    await enforceDual(request, 'login', RATE_LIMITS.login, body.email);

    const ip = clientIp(request);
    const agent = userAgent(request);

    const rows = await db.select().from(clientAccounts).where(eq(clientAccounts.email, body.email)).limit(1);
    const account = rows[0];

    if (!account) {
      await fakeVerify();
      await logLoginAttempt(body.email, ip, agent, false, 'unknown_account');
      throw unauthorized('Email or password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      await logLoginAttempt(body.email, ip, agent, false, 'locked');
      throw new AppError(
        ERROR_CODES.ACCOUNT_LOCKED,
        'Too many failed attempts. Try again shortly or reset your password.',
        423,
      );
    }

    await applyBackoff(account.failedLoginCount);
    const valid = await verifyPassword(account.passwordHash, body.password);

    if (!valid) {
      const failures = account.failedLoginCount + 1;
      await db
        .update(clientAccounts)
        .set({
          failedLoginCount: failures,
          lockedUntil: failures >= LOGIN_LOCK_THRESHOLD ? addMinutes(new Date(), LOGIN_LOCK_MINUTES) : null,
          updatedAt: new Date(),
        })
        .where(eq(clientAccounts.id, account.id));

      await logLoginAttempt(body.email, ip, agent, false, 'bad_password');
      throw unauthorized('Email or password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (account.status === 'suspended') {
      await logLoginAttempt(body.email, ip, agent, false, 'suspended');
      throw forbidden('This account is suspended. Contact support.', ERROR_CODES.ACCOUNT_SUSPENDED);
    }
    if (account.status === 'closed') {
      await logLoginAttempt(body.email, ip, agent, false, 'closed');
      throw unauthorized('This account is closed.');
    }
    if (!account.emailVerified) {
      // The account exists but was never activated; send a fresh code so the
      // dead end is recoverable from the sign-in form itself.
      const existing = await findLiveVerificationCode(account.id);
      if (resendWaitSeconds(existing?.sentAt) === 0) {
        await issueVerificationCode(request, account);
      }

      await logLoginAttempt(body.email, ip, agent, false, 'unverified');
      throw forbidden('Verify your email address to continue.', ERROR_CODES.EMAIL_NOT_VERIFIED);
    }

    await db
      .update(clientAccounts)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(clientAccounts.id, account.id));

    await resetRateLimit('login:id', body.email);
    await revokeUnverifiedClientSessions(account.id);

    /*
     * The password alone never produces a usable session. A challenge is issued
     * instead, under its own short-lived cookie, and only the emailed passcode
     * promotes it — so a leaked password is not by itself a way into the store.
     */
    const code = generateOtp();
    const expiresAt = otpExpiry(config.security.otpTtlMinutes);
    const session = await createClientSession(request, account.id, body.remember, {
      otpVerified: false,
      otpCodeHash: hashOtp(code),
      otpExpiresAt: expiresAt,
    });

    setSessionCookie(reply, 'clientOtp', session);
    clearSessionCookie(reply, 'client');
    logCodeInDevelopment(request, 'client_sign_in', account.email, code);

    // Best effort: a mail outage must not leave the caller unable to retry, and
    // the code can always be resent.
    await emails
      .clientSignInCode(account.email, account.fullName, code, config.security.otpTtlMinutes, ip, account.id)
      .catch((error: unknown) => {
        request.log.error({ err: (error as Error).message }, 'client sign-in code email failed');
      });

    await logLoginAttempt(body.email, ip, agent, false, 'awaiting_otp');

    return ok(reply, {
      otpRequired: true as const,
      // Masked: the form can say where the code went without publishing the
      // full address to anyone looking over the caller's shoulder.
      sentTo: maskEmail(account.email),
      expiresAt,
    });
  });

  /**
   * Completes sign-in with the emailed passcode.
   *
   * Guarded by `requireClientPartial`, so the code is checked against the very
   * challenge it was issued for — a passcode from one attempt is simply absent
   * from any other session row.
   */
  app.post('/login/otp/verify', { preHandler: app.requireClientPartial }, async (request, reply) => {
    await enforce(request, 'client-otp', RATE_LIMITS.clientOtpVerify, request.clientAuth!.accountId);
    const { code } = parseBody(z.object({ code: otpCodeSchema }), request.body);

    const auth = request.clientAuth!;
    const session = await findClientSessionById(auth.sessionId);
    if (!session) throw unauthorized('Start again from the sign-in page.', ERROR_CODES.SESSION_EXPIRED);

    const rows = await db
      .select({
        id: clientAccounts.id,
        email: clientAccounts.email,
        onboardingCompleted: clientAccounts.onboardingCompleted,
      })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, auth.accountId))
      .limit(1);

    const account = rows[0];
    if (!account) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);

    if (session.otpVerified) {
      // Already promoted — re-verifying must not mint a second way in.
      return ok(reply, { signedIn: true as const, onboardingCompleted: account.onboardingCompleted });
    }

    if (isOtpExpired(session.otpExpiresAt)) {
      throw new AppError(ERROR_CODES.OTP_EXPIRED, 'That code has expired. Request a new one.', 401);
    }

    const endChallenge = async () => {
      await revokeClientSession(session.id);
      clearSessionCookie(reply, 'clientOtp');
      return new AppError(ERROR_CODES.OTP_TOO_MANY_ATTEMPTS, 'Too many incorrect codes. Sign in again.', 429);
    };

    /*
     * Six digits is a million combinations, but a challenge that tolerated
     * unlimited guessing for its whole lifetime would still fall to a script.
     * The attempt cap is what makes the short code safe.
     */
    if (session.otpAttempts >= OTP_MAX_ATTEMPTS) throw await endChallenge();

    if (!verifyOtp(session.otpCodeHash, code)) {
      const attempts = await registerClientOtpAttempt(session.id);
      await logLoginAttempt(account.email, clientIp(request), userAgent(request), false, 'bad_otp');
      if (attempts >= OTP_MAX_ATTEMPTS) throw await endChallenge();
      throw new AppError(ERROR_CODES.OTP_INVALID, 'That code is not correct.', 401);
    }

    // Rotate the token on elevation, then move the cookie across.
    const promoted = await promoteClientSession(session.id, session.remember);
    clearSessionCookie(reply, 'clientOtp');
    setSessionCookie(reply, 'client', promoted);

    const now = new Date();
    await db
      .update(clientAccounts)
      .set({ lastLoginAt: now, lastLoginIp: clientIp(request) || null, updatedAt: now })
      .where(eq(clientAccounts.id, account.id));

    await logLoginAttempt(account.email, clientIp(request), userAgent(request), true);

    return ok(reply, { signedIn: true as const, onboardingCompleted: account.onboardingCompleted });
  });

  /** Issues a fresh passcode against the same challenge. */
  app.post('/login/otp/resend', { preHandler: app.requireClientPartial }, async (request, reply) => {
    await enforce(request, 'client-otp-resend', RATE_LIMITS.clientOtpResend, request.clientAuth!.accountId);

    const auth = request.clientAuth!;
    const session = await findClientSessionById(auth.sessionId);
    if (!session || session.otpVerified) {
      throw unauthorized('Start again from the sign-in page.', ERROR_CODES.SESSION_EXPIRED);
    }

    // A cooldown on top of the rate limit, so the endpoint cannot be used to
    // flood an inbox even within an allowed budget.
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
    await replaceClientSessionOtp(session.id, hashOtp(code), expiresAt);
    logCodeInDevelopment(request, 'client_sign_in', auth.email, code);

    await emails
      .clientSignInCode(
        auth.email,
        auth.fullName,
        code,
        config.security.otpTtlMinutes,
        clientIp(request),
        auth.accountId,
      )
      .catch((error: unknown) => {
        request.log.error({ err: (error as Error).message }, 'client sign-in code resend failed');
      });

    return ok(reply, { sentTo: maskEmail(auth.email), expiresAt });
  });

  app.post('/logout', async (request, reply) => {
    const token = readSessionToken(request, 'client') ?? readSessionToken(request, 'clientOtp');
    if (token) {
      const session = await findClientSession(token);
      if (session) await revokeClientSession(session.id);
    }
    // Clear both unconditionally — this doubles as "cancel the passcode step".
    clearSessionCookie(reply, 'client');
    clearSessionCookie(reply, 'clientOtp');
    return ok(reply, { signedOut: true });
  });

  // --- Password reset ---------------------------------------------------------

  app.post('/forgot-password', async (request, reply) => {
    const { email } = parseBody(z.object({ email: emailSchema }), request.body);
    await enforceDual(request, 'forgot-password', RATE_LIMITS.forgotPassword, email);

    const rows = await db
      .select({ id: clientAccounts.id, email: clientAccounts.email, fullName: clientAccounts.fullName })
      .from(clientAccounts)
      .where(eq(clientAccounts.email, email))
      .limit(1);

    const account = rows[0];
    if (account) {
      const token = generateToken(32);
      await db.insert(clientPasswordResetTokens).values({
        clientAccountId: account.id,
        tokenHash: sha256(token),
        expiresAt: addMinutes(new Date(), TOKEN_TTL.passwordResetMinutes),
        requestedIp: clientIp(request) || null,
      });

      const resetUrl = `${config.urls.website}/reset-password?token=${encodeURIComponent(token)}`;
      await emails.passwordReset(account.email, account.fullName, resetUrl, account.id);
    }

    // Identical response whether or not the address exists.
    return ok(reply, { sent: true });
  });

  app.post('/reset-password', async (request, reply) => {
    const body = parseBody(
      z.object({ token: z.string().trim().min(20).max(200), password: passwordSchema }),
      request.body,
    );

    const rows = await db
      .select()
      .from(clientPasswordResetTokens)
      .where(
        and(
          eq(clientPasswordResetTokens.tokenHash, sha256(body.token)),
          isNull(clientPasswordResetTokens.usedAt),
          gt(clientPasswordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const record = rows[0];
    if (!record) {
      throw new AppError(ERROR_CODES.INVALID_TOKEN, 'This reset link is invalid or has expired.', 400);
    }

    const now = new Date();
    const passwordHash = await hashPassword(body.password);

    await db
      .update(clientPasswordResetTokens)
      .set({ usedAt: now })
      .where(eq(clientPasswordResetTokens.id, record.id));

    await db
      .update(clientAccounts)
      .set({
        passwordHash,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(clientAccounts.id, record.clientAccountId));

    // Every existing session is invalidated — a reset must lock out an attacker.
    // Only this account's sessions: the store admin panel has its own login and
    // its own reset, and resetting one is deliberately not resetting the other.
    const { revokeAllClientSessions } = await import('../../lib/session');
    await revokeAllClientSessions(record.clientAccountId);

    return ok(reply, { reset: true });
  });

  // --- Contact form -----------------------------------------------------------

  app.post('/contact', async (request, reply) => {
    await enforce(request, 'contact', RATE_LIMITS.contact);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(2).max(120),
        email: emailSchema,
        company: z.string().trim().max(160).optional(),
        message: z.string().trim().min(10).max(2000),
      }),
      request.body,
    );

    await db.insert(contactMessages).values({
      name: body.name,
      email: body.email,
      company: body.company ?? null,
      message: body.message,
      ipAddress: clientIp(request) || null,
    });

    return ok(reply, { sent: true }, 201);
  });

  // --- Health-ish counter used by the marketing page (no PII) ------------------

  app.get('/stats', async (_request, reply) => {
    const rows = await db.select({ total: count() }).from(tenants).where(eq(tenants.storeStatus, 'ready'));
    return ok(reply, { activeStores: Number(rows[0]?.total ?? 0) });
  });
}
