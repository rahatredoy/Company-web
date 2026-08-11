import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../../config/index';
import { adminSessions, storeAdmins } from '../../db/schema/index';
import { RATE_LIMITS, STORE_ROLES, type StoreRole } from '../../lib/constants';
import { audit, securityEvent } from '../../lib/audit';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { ERROR_CODES, badRequest, forbidden, unauthorized } from '../../lib/errors';
import { clientIp, noContent, ok, parseBody, parseParams } from '../../lib/http';
import { fakeVerify, verifyPassword } from '../../lib/password';
import { enforce, enforceDual } from '../../lib/rate-limit';
import {
  clearSessionCookie,
  createAdminSession,
  findAdminSession,
  promoteAdminSession,
  readSessionToken,
  refreshSessionAuth,
  revokeAllSessions,
  revokeSession,
  revokeUnverifiedSessions,
  setSessionCookie,
} from '../../lib/session';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from '../../lib/totp';
import {
  emailSchema,
  opaqueTokenSchema,
  passwordSchema,
  recoveryCodeSchema,
  totpCodeSchema,
} from '../../lib/validation';
import { effectivePermissions } from '../../services/permissions';
import { storeOf } from '../../plugins/tenant';
import {
  clearFailures,
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
  issueToken,
  recordLoginAttempt,
  redeemToken,
  regenerateRecoveryCodes,
  registerFailure,
  sendPasswordResetEmail,
  setPassword,
} from './service';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(200),
  remember: z.boolean().default(false),
});

const emailOnlySchema = z.object({ email: emailSchema });

const resetPasswordSchema = z
  .object({
    token: opaqueTokenSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

const mfaVerifySchema = z.object({
  code: z.string().trim().min(6).max(14),
  remember: z.boolean().default(false),
});

const reauthSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  code: totpCodeSchema.optional(),
});

/**
 * Everything the panel needs to render its shell, in one response.
 *
 * Reads the admin straight from the database rather than from
 * `request.storeAdmin`, because the three routes that mint a session have only
 * just written the cookie onto the *reply* — it is not on the request, so the
 * guard cannot have run.
 */
async function sessionPayload(request: FastifyRequest, adminId: string) {
  const store = storeOf(request);

  const [admin] = await store.db
    .select({
      id: storeAdmins.id,
      email: storeAdmins.email,
      fullName: storeAdmins.fullName,
      roleKey: storeAdmins.roleKey,
      mfaEnabled: storeAdmins.mfaEnabled,
    })
    .from(storeAdmins)
    .where(eq(storeAdmins.id, adminId))
    .limit(1);

  if (!admin) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);

  const permissions = await effectivePermissions(store.db, {
    id: admin.id,
    roleKey: admin.roleKey as StoreRole,
  });

  return {
    authenticated: true as const,
    admin: {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      roleKey: admin.roleKey,
      mfaEnabled: admin.mfaEnabled,
      permissions: [...permissions],
    },
    store: {
      slug: store.slug,
      name: store.storeName,
      currency: store.currency,
      language: store.language,
      timezone: store.timezone,
      status: store.status,
      planCode: store.entitlements?.planCode ?? null,
      planName: store.entitlements?.planName ?? null,
      trial: store.trial,
      entitlements: store.entitlements,
    },
  };
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Bootstrap for the panel. Deliberately **unguarded**: a signed-out visitor
   * must get a clean `{ authenticated: false }` rather than a 401, or the panel
   * cannot tell "not signed in" from "something broke" and loops on the login
   * page.
   */
  app.get('/auth/session', async (request, reply) => {
    const store = storeOf(request);
    const token = readSessionToken(request, 'admin');

    if (token) {
      const session = await findAdminSession(store.db, token);
      if (session?.mfaVerified && session.tenantRef === store.tenantRef) {
        await app.requireStoreAdmin(request, reply);
        return ok(reply, await sessionPayload(request, session.adminId));
      }
    }

    // An in-flight MFA challenge is reported so the panel can show the code form
    // instead of the password form after a refresh.
    const challenge = readSessionToken(request, 'adminMfa');
    const pending = challenge ? await findAdminSession(store.db, challenge) : null;

    return ok(reply, {
      authenticated: false as const,
      mfaPending: Boolean(pending && !pending.mfaVerified && pending.tenantRef === store.tenantRef),
      store: { slug: store.slug, name: store.storeName, status: store.status },
    });
  });

  // ---------------------------------------------------------------- login ----

  app.post('/auth/login', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(loginSchema, request.body);
    await enforceDual(request, 'login', RATE_LIMITS.login, body.email);

    const rows = await store.db
      .select({
        id: storeAdmins.id,
        email: storeAdmins.email,
        passwordHash: storeAdmins.passwordHash,
        accountStatus: storeAdmins.accountStatus,
        failedLoginCount: storeAdmins.failedLoginCount,
        lockedUntil: storeAdmins.lockedUntil,
        mfaEnabled: storeAdmins.mfaEnabled,
      })
      .from(storeAdmins)
      .where(eq(sql`lower(${storeAdmins.email})`, body.email))
      .limit(1);

    const admin = rows[0];

    if (!admin) {
      // Constant-ish work for an unknown address, so response time does not
      // reveal whether the account exists.
      await fakeVerify();
      await recordLoginAttempt(store.db, request, {
        email: body.email,
        successful: false,
        failureReason: 'unknown_account',
      });
      throw unauthorized('Email or password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw forbidden(
        'Too many failed attempts. This account is locked for a few minutes.',
        ERROR_CODES.ACCOUNT_LOCKED,
      );
    }

    if (admin.accountStatus === 'disabled') {
      await recordLoginAttempt(store.db, request, {
        email: body.email,
        successful: false,
        failureReason: 'disabled',
      });
      throw forbidden('This account has been disabled.', ERROR_CODES.ACCOUNT_DISABLED);
    }

    /*
     * The password is seeded by company provisioning, so a row without one means
     * the store was created before that step landed — a support problem, not a
     * wrong password. Say so plainly: this panel has no sign-up of its own, so
     * the owner has no other way to find out why they cannot get in.
     */
    if (!admin.passwordHash) {
      throw forbidden(
        'This account is not ready yet. Contact support to finish setting up your store.',
        ERROR_CODES.ACCOUNT_NOT_READY,
      );
    }

    const valid = await verifyPassword(admin.passwordHash, body.password);
    if (!valid) {
      await registerFailure(store.db, admin.id, admin.failedLoginCount);
      await recordLoginAttempt(store.db, request, {
        email: body.email,
        successful: false,
        failureReason: 'bad_password',
      });
      await securityEvent(store.db, request, 'login_failed', { adminId: admin.id });
      throw unauthorized('Email or password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    await clearFailures(store.db, admin.id, clientIp(request));
    // Any half-finished challenge from a previous attempt is dead now.
    await revokeUnverifiedSessions(store.db, admin.id);

    if (admin.mfaEnabled) {
      const challenge = await createAdminSession(store.db, request, {
        adminId: admin.id,
        tenantRef: store.tenantRef,
        mfaVerified: false,
        remember: body.remember,
      });
      setSessionCookie(request, reply, 'adminMfa', challenge);
      clearSessionCookie(request, reply, 'admin');
      return ok(reply, { authenticated: false as const, mfaRequired: true as const });
    }

    const session = await createAdminSession(store.db, request, {
      adminId: admin.id,
      tenantRef: store.tenantRef,
      mfaVerified: true,
      remember: body.remember,
    });
    setSessionCookie(request, reply, 'admin', session);
    clearSessionCookie(request, reply, 'adminMfa');

    await recordLoginAttempt(store.db, request, { email: body.email, successful: true });
    await securityEvent(store.db, request, 'login_success', { adminId: admin.id });

    return ok(reply, await sessionPayload(request, admin.id));
  });

  /**
   * Completes an MFA challenge. Accepts either a TOTP code or a recovery code;
   * both rotate the session token so the pre-MFA value cannot be replayed.
   */
  app.post(
    '/auth/mfa/verify',
    { preHandler: [app.requireStoreAdminPartial] },
    async (request, reply) => {
      const store = storeOf(request);
      const partial = request.storeAdminPartial!;
      const body = parseBody(mfaVerifySchema, request.body);
      await enforceDual(request, 'mfa-verify', RATE_LIMITS.mfaVerify, partial.adminId);

      const [admin] = await store.db
        .select({
          id: storeAdmins.id,
          email: storeAdmins.email,
          mfaSecretEncrypted: storeAdmins.mfaSecretEncrypted,
        })
        .from(storeAdmins)
        .where(eq(storeAdmins.id, partial.adminId))
        .limit(1);

      if (!admin?.mfaSecretEncrypted) {
        throw badRequest('Two-factor authentication is not set up.', ERROR_CODES.MFA_NOT_ENABLED);
      }

      const isRecovery = body.code.includes('-');
      const accepted = isRecovery
        ? await consumeRecoveryCode(
            store.db,
            admin.id,
            recoveryCodeSchema.parse(body.code),
          )
        : verifyTotp(decryptSecret(admin.mfaSecretEncrypted), totpCodeSchema.parse(body.code));

      if (!accepted) {
        await securityEvent(store.db, request, 'login_failed', {
          adminId: admin.id,
          description: 'Invalid two-factor code',
        });
        throw unauthorized('That code is not valid.', ERROR_CODES.MFA_INVALID);
      }

      const remember = body.remember || partial.remember;
      const promoted = await promoteAdminSession(store.db, partial.sessionId, remember);
      setSessionCookie(request, reply, 'admin', promoted);
      clearSessionCookie(request, reply, 'adminMfa');

      await clearFailures(store.db, admin.id, clientIp(request));
      await recordLoginAttempt(store.db, request, { email: admin.email, successful: true });
      await securityEvent(store.db, request, 'login_success', {
        adminId: admin.id,
        description: isRecovery ? 'Signed in with a recovery code' : undefined,
      });

      return ok(reply, await sessionPayload(request, admin.id));
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const store = storeOf(request);

    for (const audience of ['admin', 'adminMfa'] as const) {
      const token = readSessionToken(request, audience);
      if (!token) continue;
      const session = await findAdminSession(store.db, token);
      if (session) {
        await revokeSession(store.db, session.id);
        await securityEvent(store.db, request, 'logout', { adminId: session.adminId });
      }
      clearSessionCookie(request, reply, audience);
    }

    return ok(reply, { message: 'Signed out.' });
  });

  // -------------------------------------------------------------- recovery ----

  /** Always answers 200 — never reveals whether an address has an account. */
  app.post('/auth/forgot-password', async (request, reply) => {
    const store = storeOf(request);
    const { email } = parseBody(emailOnlySchema, request.body);
    await enforceDual(request, 'forgot-password', RATE_LIMITS.forgotPassword, email);

    const [admin] = await store.db
      .select({
        id: storeAdmins.id,
        email: storeAdmins.email,
        fullName: storeAdmins.fullName,
        accountStatus: storeAdmins.accountStatus,
      })
      .from(storeAdmins)
      .where(eq(sql`lower(${storeAdmins.email})`, email))
      .limit(1);

    if (admin && admin.accountStatus === 'active') {
      const { token } = await issueToken(store.db, request, admin.id, 'password_reset');
      await sendPasswordResetEmail({
        slug: store.slug,
        storeName: store.storeName,
        email: admin.email,
        fullName: admin.fullName,
        token,
      });
      await securityEvent(store.db, request, 'password_reset_requested', { adminId: admin.id });
    }

    return ok(reply, { message: 'If that address has an account, a reset link is on its way.' });
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(resetPasswordSchema, request.body);
    await enforce(request, 'reset-password', RATE_LIMITS.forgotPassword);

    const redeemed = await redeemToken(store.db, body.token, 'password_reset');
    if (!redeemed) {
      throw badRequest('This reset link has expired or has already been used.', ERROR_CODES.TOKEN_EXPIRED);
    }

    await setPassword(store.db, redeemed.adminId, body.password);
    // Every other device is signed out — a reset is how a compromise is undone.
    await revokeAllSessions(store.db, redeemed.adminId);
    await securityEvent(store.db, request, 'password_changed', {
      adminId: redeemed.adminId,
      description: 'Password reset by email link',
    });

    clearSessionCookie(request, reply, 'admin');
    clearSessionCookie(request, reply, 'adminMfa');
    return ok(reply, { message: 'Your password has been changed. Sign in with it now.' });
  });

  /**
   * Re-proves identity for a session that is still live but past the reauth
   * window. Without this, a `REAUTH_REQUIRED` response is a dead end — the user
   * would have to sign out and back in to change a setting.
   */
  app.post('/auth/reauth', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const admin = request.storeAdmin!;
    const body = parseBody(reauthSchema, request.body);
    await enforceDual(request, 'reauth', RATE_LIMITS.reauth, admin.adminId);

    const [row] = await store.db
      .select({ passwordHash: storeAdmins.passwordHash, mfaSecretEncrypted: storeAdmins.mfaSecretEncrypted })
      .from(storeAdmins)
      .where(eq(storeAdmins.id, admin.adminId))
      .limit(1);

    let proved = false;
    if (body.password && row?.passwordHash) {
      proved = await verifyPassword(row.passwordHash, body.password);
    } else if (body.code && row?.mfaSecretEncrypted) {
      proved = verifyTotp(decryptSecret(row.mfaSecretEncrypted), body.code);
    }

    if (!proved) {
      throw unauthorized('That did not match. Try again.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    await refreshSessionAuth(store.db, admin.sessionId, admin.remember);
    return ok(reply, { message: 'Confirmed.' });
  });

  // ------------------------------------------------------------------ MFA ----

  /**
   * Step one of enabling MFA: mints a secret and returns it as a QR code. The
   * secret is stored encrypted but `mfa_enabled` stays false until a code from
   * the app proves the user actually scanned it.
   */
  app.post(
    '/auth/mfa/setup',
    { preHandler: [app.requireStoreAdmin, app.requireReauth] },
    async (request, reply) => {
      const store = storeOf(request);
      const admin = request.storeAdmin!;

      if (admin.mfaEnabled) {
        throw badRequest('Two-factor authentication is already on.', ERROR_CODES.MFA_ALREADY_ENABLED);
      }

      const secret = generateTotpSecret();
      await store.db
        .update(storeAdmins)
        .set({ mfaSecretEncrypted: encryptSecret(secret), updatedAt: new Date() })
        .where(eq(storeAdmins.id, admin.adminId));

      const otpauth = buildOtpAuthUrl(secret, admin.email, `${store.storeName} Admin`);
      return ok(reply, {
        secret,
        otpauthUrl: otpauth,
        qrCode: await QRCode.toDataURL(otpauth, { margin: 1, width: 240 }),
      });
    },
  );

  app.post(
    '/auth/mfa/enable',
    { preHandler: [app.requireStoreAdmin, app.requireReauth] },
    async (request, reply) => {
      const store = storeOf(request);
      const admin = request.storeAdmin!;
      const { code } = parseBody(z.object({ code: totpCodeSchema }), request.body);

      const [row] = await store.db
        .select({ mfaSecretEncrypted: storeAdmins.mfaSecretEncrypted })
        .from(storeAdmins)
        .where(eq(storeAdmins.id, admin.adminId))
        .limit(1);

      if (!row?.mfaSecretEncrypted) {
        throw badRequest('Start the set-up again.', ERROR_CODES.MFA_NOT_ENABLED);
      }
      if (!verifyTotp(decryptSecret(row.mfaSecretEncrypted), code)) {
        throw badRequest('That code is not valid. Check your authenticator app.', ERROR_CODES.MFA_INVALID);
      }

      await store.db
        .update(storeAdmins)
        .set({ mfaEnabled: true, mfaEnabledAt: new Date(), updatedAt: new Date() })
        .where(eq(storeAdmins.id, admin.adminId));

      const codes = await regenerateRecoveryCodes(store.db, admin.adminId);
      await securityEvent(store.db, request, 'mfa_enabled', { adminId: admin.adminId });
      await audit(store.db, request, { action: 'mfa.enable', module: 'security', entity: 'admin', entityId: admin.adminId });

      // Shown exactly once — only the hashes are kept.
      return ok(reply, { recoveryCodes: codes });
    },
  );

  app.post(
    '/auth/mfa/disable',
    { preHandler: [app.requireStoreAdmin, app.requireReauth] },
    async (request, reply) => {
      const store = storeOf(request);
      const admin = request.storeAdmin!;

      await store.db
        .update(storeAdmins)
        .set({ mfaEnabled: false, mfaSecretEncrypted: null, mfaEnabledAt: null, updatedAt: new Date() })
        .where(eq(storeAdmins.id, admin.adminId));

      await securityEvent(store.db, request, 'mfa_disabled', { adminId: admin.adminId });
      await audit(store.db, request, { action: 'mfa.disable', module: 'security', entity: 'admin', entityId: admin.adminId });
      return ok(reply, { message: 'Two-factor authentication is off.' });
    },
  );

  app.post(
    '/auth/mfa/recovery-codes',
    { preHandler: [app.requireStoreAdmin, app.requireReauth] },
    async (request, reply) => {
      const store = storeOf(request);
      const admin = request.storeAdmin!;
      await enforceDual(request, 'recovery-codes', RATE_LIMITS.recoveryCodes, admin.adminId);

      if (!admin.mfaEnabled) {
        throw badRequest('Turn on two-factor authentication first.', ERROR_CODES.MFA_NOT_ENABLED);
      }

      const codes = await regenerateRecoveryCodes(store.db, admin.adminId);
      await securityEvent(store.db, request, 'recovery_codes_regenerated', { adminId: admin.adminId });
      return ok(reply, { recoveryCodes: codes });
    },
  );

  app.get('/auth/mfa/status', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const admin = request.storeAdmin!;
    return ok(reply, {
      enabled: admin.mfaEnabled,
      recoveryCodesRemaining: admin.mfaEnabled
        ? await countUnusedRecoveryCodes(store.db, admin.adminId)
        : 0,
      // A super admin running without MFA is the platform's biggest single risk.
      recommended: admin.roleKey === STORE_ROLES.superAdmin,
    });
  });

  // ------------------------------------------------------------- sessions ----

  app.get('/auth/sessions', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const admin = request.storeAdmin!;

    const rows = await store.db
      .select({
        id: adminSessions.id,
        ipAddress: adminSessions.ipAddress,
        userAgent: adminSessions.userAgent,
        lastSeenAt: adminSessions.lastSeenAt,
        createdAt: adminSessions.createdAt,
        expiresAt: adminSessions.expiresAt,
      })
      .from(adminSessions)
      .where(
        and(
          eq(adminSessions.adminId, admin.adminId),
          eq(adminSessions.mfaVerified, true),
          isNull(adminSessions.revokedAt),
        ),
      )
      .orderBy(desc(adminSessions.lastSeenAt))
      .limit(50);

    return ok(
      reply,
      rows.map((row) => ({ ...row, current: row.id === admin.sessionId })),
    );
  });

  app.delete('/auth/sessions/:id', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const admin = request.storeAdmin!;
    const { id } = parseParams(z.object({ id: z.string().uuid() }), request.params);

    // Ownership check: a session id from another admin must not be revocable.
    const [session] = await store.db
      .select({ id: adminSessions.id })
      .from(adminSessions)
      .where(and(eq(adminSessions.id, id), eq(adminSessions.adminId, admin.adminId)))
      .limit(1);

    if (!session) throw forbidden('That session does not belong to you.');

    await revokeSession(store.db, id);
    await securityEvent(store.db, request, 'session_revoked', { adminId: admin.adminId });

    if (id === admin.sessionId) clearSessionCookie(request, reply, 'admin');
    return noContent(reply);
  });

  app.delete('/auth/sessions', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const admin = request.storeAdmin!;

    await revokeAllSessions(store.db, admin.adminId, admin.sessionId);
    await securityEvent(store.db, request, 'session_revoked', {
      adminId: admin.adminId,
      description: 'Signed out of all other devices',
    });
    return ok(reply, { message: 'Signed out everywhere else.' });
  });

  // ------------------------------------------------------------- profile ----

  app.put(
    '/auth/password',
    { preHandler: [app.requireStoreAdmin] },
    async (request, reply) => {
      const store = storeOf(request);
      const admin = request.storeAdmin!;
      const body = parseBody(
        z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }),
        request.body,
      );

      const [row] = await store.db
        .select({ passwordHash: storeAdmins.passwordHash })
        .from(storeAdmins)
        .where(eq(storeAdmins.id, admin.adminId))
        .limit(1);

      if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, body.currentPassword))) {
        throw unauthorized('Your current password is not correct.', ERROR_CODES.INVALID_CREDENTIALS);
      }

      await setPassword(store.db, admin.adminId, body.newPassword);
      // Keep this device signed in; drop every other one.
      await revokeAllSessions(store.db, admin.adminId, admin.sessionId);
      await refreshSessionAuth(store.db, admin.sessionId, admin.remember);
      await securityEvent(store.db, request, 'password_changed', { adminId: admin.adminId });

      return ok(reply, { message: 'Password changed. Other devices have been signed out.' });
    },
  );

  app.get('/auth/permissions', { preHandler: [app.requireStoreAdmin] }, async (request, reply) => {
    const store = storeOf(request);
    const admin = request.storeAdmin!;
    const granted = await effectivePermissions(store.db, {
      id: admin.adminId,
      roleKey: admin.roleKey as StoreRole,
    });
    return ok(reply, {
      roleKey: admin.roleKey,
      permissions: [...granted],
      reauthWindowMinutes: config.security.reauthWindowMinutes,
    });
  });
}
