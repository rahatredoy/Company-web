import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { TenantDb, TenantExecutor } from '../../db/tenant-manager';
import {
  adminLoginAttempts,
  adminPasswordResetTokens,
  adminRecoveryCodes,
  storeAdmins,
} from '../../db/schema/index';
import { generateRecoveryCode, generateToken, sha256 } from '../../lib/crypto';
import {
  LOGIN_BACKOFF_MS,
  LOGIN_LOCK_MINUTES,
  LOGIN_LOCK_THRESHOLD,
  RECOVERY_CODE_COUNT,
  TOKEN_TTL,
} from '../../lib/constants';
import { addMinutes, sleep } from '../../lib/utils';
import { clientIp, userAgent } from '../../lib/http';
import type { Language } from '../../lib/languages';
import { button, layout, mailText, paragraph, sendMail } from '../../lib/mailer';
import { adminUrl } from '../../lib/urls';
import { hashPassword } from '../../lib/password';

/**
 * Password reset is the only link this platform issues. There is no account
 * set-up link: the admin account arrives from company provisioning with the
 * password its owner registered with, already usable.
 */
export type TokenPurpose = 'password_reset';

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Issues a single-use link token.
 *
 * Only the SHA-256 is stored, so the database never holds anything that can be
 * replayed as a link. Any outstanding token for the same purpose is burned
 * first, so requesting a new link always invalidates the old one.
 */
export async function issueToken(
  db: TenantDb,
  request: FastifyRequest,
  adminId: string,
  purpose: TokenPurpose,
): Promise<IssuedToken> {
  const token = generateToken(32);
  const expiresAt = addMinutes(new Date(), TOKEN_TTL.passwordResetMinutes);

  await db
    .update(adminPasswordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(adminPasswordResetTokens.adminId, adminId),
        eq(adminPasswordResetTokens.purpose, purpose),
        isNull(adminPasswordResetTokens.usedAt),
      ),
    );

  await db.insert(adminPasswordResetTokens).values({
    adminId,
    tokenHash: sha256(token),
    purpose,
    expiresAt,
    requestedIp: clientIp(request) || null,
  });

  return { token, expiresAt };
}

/**
 * Redeems a token atomically: the same `UPDATE … WHERE used_at IS NULL` both
 * validates and burns it, so two concurrent submissions cannot both succeed.
 */
export async function redeemToken(
  db: TenantExecutor,
  token: string,
  purpose: TokenPurpose,
): Promise<{ adminId: string } | null> {
  const rows = await db
    .update(adminPasswordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(adminPasswordResetTokens.tokenHash, sha256(token)),
        eq(adminPasswordResetTokens.purpose, purpose),
        isNull(adminPasswordResetTokens.usedAt),
        gt(adminPasswordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning({ adminId: adminPasswordResetTokens.adminId });

  return rows[0] ?? null;
}

/**
 * Written in the store's language, because the owner reads it in the same
 * language as the panel it resets. `language` defaults to English, whose output
 * is exactly what this mail always said.
 */
export async function sendPasswordResetEmail(
  input: { slug: string; storeName: string; email: string; fullName: string; token: string; language?: Language },
): Promise<void> {
  const url = adminUrl(input.slug, `/reset-password?token=${input.token}`);
  const firstName = input.fullName.split(' ')[0] ?? 'there';
  const language = input.language ?? 'en';
  const say = (text: string, values?: Record<string, string | number>) => mailText(language, text, values);
  const expiry = say(
    'This link expires in {minutes} minutes. If you did not request it, ignore this email — your password has not changed.',
    { minutes: TOKEN_TTL.passwordResetMinutes },
  );

  await sendMail({
    to: input.email,
    fromName: input.storeName,
    subject: say('Reset your {storeName} admin password', { storeName: input.storeName }),
    text: `${say('Hi {firstName},', { firstName })}\n\n${say('Reset your password:')}\n${url}\n\n${expiry}`,
    html: layout(
      input.storeName,
      say('Reset your password'),
      paragraph(say('Hi {firstName}, use the link below to choose a new password.', { firstName })) +
        button(say('Reset my password'), url, language) +
        paragraph(expiry),
      language,
    ),
  });
}

export async function recordLoginAttempt(
  db: TenantDb,
  request: FastifyRequest,
  input: { email: string; successful: boolean; failureReason?: string },
): Promise<void> {
  await db
    .insert(adminLoginAttempts)
    .values({
      email: input.email,
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      successful: input.successful,
      failureReason: input.failureReason ?? null,
    })
    .catch(() => undefined);
}

/**
 * Escalating delay plus a hard lock. The delay alone blunts online guessing
 * without ever locking a real user out; the lock is the backstop for a sustained
 * attack against one account.
 */
export async function registerFailure(db: TenantDb, adminId: string, currentCount: number): Promise<void> {
  const next = currentCount + 1;
  const locked = next >= LOGIN_LOCK_THRESHOLD;

  await db
    .update(storeAdmins)
    .set({
      failedLoginCount: next,
      lockedUntil: locked ? addMinutes(new Date(), LOGIN_LOCK_MINUTES) : null,
      updatedAt: new Date(),
    })
    .where(eq(storeAdmins.id, adminId));

  await sleep(LOGIN_BACKOFF_MS[Math.min(next, LOGIN_BACKOFF_MS.length - 1)] ?? 0);
}

export async function clearFailures(db: TenantDb, adminId: string, ip: string): Promise<void> {
  await db
    .update(storeAdmins)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ip || null,
      updatedAt: new Date(),
    })
    .where(eq(storeAdmins.id, adminId));
}

/**
 * Regenerates the MFA break-glass codes. Returns the plaintext once — it is
 * never retrievable again, because only the hashes are kept.
 */
export async function regenerateRecoveryCodes(db: TenantDb, adminId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

  await db.transaction(async (tx) => {
    await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));
    await tx
      .insert(adminRecoveryCodes)
      .values(codes.map((code) => ({ adminId, codeHash: sha256(code) })));
  });

  return codes;
}

/** Burns a recovery code if it matches an unused one. */
export async function consumeRecoveryCode(db: TenantDb, adminId: string, code: string): Promise<boolean> {
  const rows = await db
    .update(adminRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(adminRecoveryCodes.adminId, adminId),
        eq(adminRecoveryCodes.codeHash, sha256(code)),
        isNull(adminRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: adminRecoveryCodes.id });

  return rows.length > 0;
}

export async function countUnusedRecoveryCodes(db: TenantDb, adminId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminRecoveryCodes)
    .where(and(eq(adminRecoveryCodes.adminId, adminId), isNull(adminRecoveryCodes.usedAt)));

  return row?.count ?? 0;
}

export async function setPassword(db: TenantExecutor, adminId: string, plain: string): Promise<void> {
  await db
    .update(storeAdmins)
    .set({
      passwordHash: await hashPassword(plain),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(storeAdmins.id, adminId));
}

export async function recentLoginAttempts(db: TenantDb, email: string, limit = 10) {
  return db
    .select()
    .from(adminLoginAttempts)
    .where(eq(adminLoginAttempts.email, email))
    .orderBy(desc(adminLoginAttempts.createdAt))
    .limit(limit);
}
