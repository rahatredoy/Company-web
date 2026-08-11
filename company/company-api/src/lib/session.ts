import { and, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/client';
import { clientSessions, companyAdminSessions } from '../db/schema/index';
import { config, isProduction } from '../config/index';
import { generateToken, sha256 } from './crypto';
import { SESSION_COOKIE } from './constants';
import { addDays, addMinutes } from './utils';
import { clientIp, userAgent } from './http';

type Audience = 'admin' | 'adminOtp' | 'client' | 'clientOtp';

/** Not a session — see `lib/trusted-device.ts`. Kept here to share `COOKIE_BASE`. */
type DeviceAudience = 'adminDevice';

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  path: '/',
  // Host-only unless COOKIE_DOMAIN is set. In production with the API on a
  // different subdomain than the frontends, this must be set or the browser
  // never sends the cookie back to the panel's own origin.
  ...(config.security.cookieDomain ? { domain: config.security.cookieDomain } : {}),
};

function cookieName(audience: Audience): string {
  if (audience === 'admin') return SESSION_COOKIE.admin;
  if (audience === 'adminOtp') return SESSION_COOKIE.adminOtp;
  if (audience === 'clientOtp') return SESSION_COOKIE.clientOtp;
  return SESSION_COOKIE.client;
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: Date;
}

/**
 * Sessions are opaque random tokens; only their SHA-256 is stored, so a database
 * leak cannot be replayed as a login. Admin and client sessions live in separate
 * tables with separate cookies and are never interchangeable.
 */
export async function createClientSession(
  request: FastifyRequest,
  clientAccountId: string,
  remember: boolean,
  options: { otpVerified: boolean; otpCodeHash?: string; otpExpiresAt?: Date } = { otpVerified: true },
): Promise<CreatedSession> {
  const token = generateToken(32);
  // An unverified row is a challenge, not a session: it expires in minutes so an
  // abandoned sign-in cannot sit around waiting to be completed by someone else.
  const expiresAt = options.otpVerified
    ? clientSessionExpiry(remember)
    : addMinutes(new Date(), config.security.otpChallengeTtlMinutes);

  const [row] = await db
    .insert(clientSessions)
    .values({
      clientAccountId,
      tokenHash: sha256(token),
      remember,
      otpVerified: options.otpVerified,
      otpCodeHash: options.otpCodeHash ?? null,
      otpExpiresAt: options.otpExpiresAt ?? null,
      otpSentAt: options.otpCodeHash ? new Date() : null,
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      expiresAt,
    })
    .returning({ id: clientSessions.id });

  return { id: row!.id, token, expiresAt };
}

function clientSessionExpiry(remember: boolean): Date {
  return remember
    ? addDays(new Date(), config.security.sessionRememberTtlDays)
    : addMinutes(new Date(), config.security.sessionTtlMinutes);
}

/** Issues a fresh passcode against an existing client challenge (the resend path). */
export async function replaceClientSessionOtp(
  sessionId: string,
  codeHash: string,
  expiresAt: Date,
): Promise<void> {
  // Attempts reset with the code: guesses against a dead code must not count
  // against the new one.
  await db
    .update(clientSessions)
    .set({ otpCodeHash: codeHash, otpExpiresAt: expiresAt, otpSentAt: new Date(), otpAttempts: 0 })
    .where(eq(clientSessions.id, sessionId));
}

/** Records a failed guess and reports the running total. */
export async function registerClientOtpAttempt(sessionId: string): Promise<number> {
  const [row] = await db
    .update(clientSessions)
    .set({ otpAttempts: sql`${clientSessions.otpAttempts} + 1` })
    .where(eq(clientSessions.id, sessionId))
    .returning({ attempts: clientSessions.otpAttempts });

  return row?.attempts ?? 0;
}

/**
 * Promotion once the passcode is accepted. The token is **rotated** so the
 * pre-verification value cannot be replayed (session fixation), the passcode is
 * cleared so it cannot be reused, and the row extends to its real lifetime.
 */
export async function promoteClientSession(sessionId: string, remember: boolean): Promise<CreatedSession> {
  const token = generateToken(32);
  const expiresAt = clientSessionExpiry(remember);
  const now = new Date();

  await db
    .update(clientSessions)
    .set({
      tokenHash: sha256(token),
      otpVerified: true,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .where(eq(clientSessions.id, sessionId));

  return { id: sessionId, token, expiresAt };
}

/** Login hygiene: drop challenges that were started and never completed. */
export async function revokeUnverifiedClientSessions(clientAccountId: string): Promise<void> {
  await db
    .update(clientSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(clientSessions.clientAccountId, clientAccountId),
        eq(clientSessions.otpVerified, false),
        isNull(clientSessions.revokedAt),
      ),
    );
}

/**
 * A session created with `otpVerified: false` is a sign-in *challenge*: it lives
 * under a different cookie name, expires in minutes, and can never satisfy
 * `requireAdmin`.
 *
 * The passcode hash rides on the same row, which is what makes it single-use
 * and scoped to this one login attempt — a code issued for one challenge is
 * simply not present on any other.
 */
export async function createAdminSession(
  request: FastifyRequest,
  adminId: string,
  options: { otpVerified: boolean; otpCodeHash?: string; otpExpiresAt?: Date },
): Promise<CreatedSession> {
  const token = generateToken(32);
  const expiresAt = addMinutes(
    new Date(),
    options.otpVerified ? config.security.adminSessionTtlMinutes : config.security.otpChallengeTtlMinutes,
  );

  const [row] = await db
    .insert(companyAdminSessions)
    .values({
      adminId,
      tokenHash: sha256(token),
      otpVerified: options.otpVerified,
      otpCodeHash: options.otpCodeHash ?? null,
      otpExpiresAt: options.otpExpiresAt ?? null,
      otpSentAt: options.otpCodeHash ? new Date() : null,
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      expiresAt,
    })
    .returning({ id: companyAdminSessions.id });

  return { id: row!.id, token, expiresAt };
}

/** Issues a fresh passcode against an existing challenge (the resend path). */
export async function replaceSessionOtp(
  sessionId: string,
  codeHash: string,
  expiresAt: Date,
): Promise<void> {
  // Attempts reset with the code: the old one is dead, so guesses against it
  // should not count against the new one.
  await db
    .update(companyAdminSessions)
    .set({ otpCodeHash: codeHash, otpExpiresAt: expiresAt, otpSentAt: new Date(), otpAttempts: 0 })
    .where(eq(companyAdminSessions.id, sessionId));
}

/** Records a failed guess and reports the running total. */
export async function registerOtpAttempt(sessionId: string): Promise<number> {
  const [row] = await db
    .update(companyAdminSessions)
    .set({ otpAttempts: sql`${companyAdminSessions.otpAttempts} + 1` })
    .where(eq(companyAdminSessions.id, sessionId))
    .returning({ attempts: companyAdminSessions.otpAttempts });

  return row?.attempts ?? 0;
}

/**
 * Privilege elevation once the passcode is accepted. The token is **rotated** so
 * the pre-verification value cannot be replayed (session fixation), the passcode
 * is cleared so it cannot be reused, and the session extends to the full TTL.
 */
export async function promoteAdminSession(sessionId: string): Promise<CreatedSession> {
  const token = generateToken(32);
  const expiresAt = addMinutes(new Date(), config.security.adminSessionTtlMinutes);
  const now = new Date();

  await db
    .update(companyAdminSessions)
    .set({
      tokenHash: sha256(token),
      otpVerified: true,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .where(eq(companyAdminSessions.id, sessionId));

  return { id: sessionId, token, expiresAt };
}

/**
 * The single writer of `authenticatedAt` for an already-verified session — this
 * is what makes `REAUTH_REQUIRED` recoverable.
 */
export async function refreshAdminSessionAuth(sessionId: string): Promise<void> {
  const now = new Date();
  await db
    .update(companyAdminSessions)
    .set({
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt: addMinutes(now, config.security.adminSessionTtlMinutes),
    })
    .where(eq(companyAdminSessions.id, sessionId));
}

/** Login hygiene: drop challenges that were started and never completed. */
export async function revokeUnverifiedAdminSessions(adminId: string): Promise<void> {
  await db
    .update(companyAdminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(companyAdminSessions.adminId, adminId),
        eq(companyAdminSessions.otpVerified, false),
        isNull(companyAdminSessions.revokedAt),
      ),
    );
}

export function setSessionCookie(reply: FastifyReply, audience: Audience, session: CreatedSession): void {
  reply.setCookie(cookieName(audience), session.token, {
    ...COOKIE_BASE,
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, audience: Audience): void {
  reply.clearCookie(cookieName(audience), COOKIE_BASE);
}

export function readSessionToken(request: FastifyRequest, audience: Audience): string | null {
  const raw = request.cookies?.[cookieName(audience)];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * The remembered-browser cookie. It outlives the session on purpose — that is
 * the entire point of it — so it is set, read and cleared on its own schedule
 * and never through the session helpers above.
 */
export function setDeviceCookie(reply: FastifyReply, audience: DeviceAudience, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE[audience], token, { ...COOKIE_BASE, expires: expiresAt });
}

export function clearDeviceCookie(reply: FastifyReply, audience: DeviceAudience): void {
  reply.clearCookie(SESSION_COOKIE[audience], COOKIE_BASE);
}

export function readDeviceToken(request: FastifyRequest, audience: DeviceAudience): string | null {
  const raw = request.cookies?.[SESSION_COOKIE[audience]];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export async function findClientSession(token: string) {
  const now = new Date();
  const rows = await db
    .select()
    .from(clientSessions)
    .where(
      and(
        eq(clientSessions.tokenHash, sha256(token)),
        isNull(clientSessions.revokedAt),
        gt(clientSessions.expiresAt, now),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Loads a client session by id, for the OTP step which already knows which one it is. */
export async function findClientSessionById(sessionId: string) {
  const rows = await db
    .select()
    .from(clientSessions)
    .where(
      and(
        eq(clientSessions.id, sessionId),
        isNull(clientSessions.revokedAt),
        gt(clientSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Loads a session by id, for the OTP step which already knows which one it is. */
export async function findAdminSessionById(sessionId: string) {
  const rows = await db
    .select()
    .from(companyAdminSessions)
    .where(
      and(
        eq(companyAdminSessions.id, sessionId),
        isNull(companyAdminSessions.revokedAt),
        gt(companyAdminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findAdminSession(token: string) {
  const now = new Date();
  const rows = await db
    .select()
    .from(companyAdminSessions)
    .where(
      and(
        eq(companyAdminSessions.tokenHash, sha256(token)),
        isNull(companyAdminSessions.revokedAt),
        gt(companyAdminSessions.expiresAt, now),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Sliding expiry: every authenticated request pushes the session forward, and
 * the new expiry is returned so the cookie can be pushed forward with it.
 */
export async function touchClientSession(sessionId: string, remember: boolean): Promise<Date> {
  const expiresAt = clientSessionExpiry(remember);
  await db
    .update(clientSessions)
    .set({ lastSeenAt: new Date(), expiresAt })
    .where(eq(clientSessions.id, sessionId));
  return expiresAt;
}

export async function touchAdminSession(sessionId: string): Promise<void> {
  await db
    .update(companyAdminSessions)
    .set({
      lastSeenAt: new Date(),
      expiresAt: addMinutes(new Date(), config.security.adminSessionTtlMinutes),
    })
    .where(eq(companyAdminSessions.id, sessionId));
}

export async function revokeClientSession(sessionId: string): Promise<void> {
  await db.update(clientSessions).set({ revokedAt: new Date() }).where(eq(clientSessions.id, sessionId));
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await db
    .update(companyAdminSessions)
    .set({ revokedAt: new Date() })
    .where(eq(companyAdminSessions.id, sessionId));
}

/** Used after a password change: every other device is signed out. */
export async function revokeAllClientSessions(clientAccountId: string, exceptSessionId?: string): Promise<void> {
  const conditions = [eq(clientSessions.clientAccountId, clientAccountId), isNull(clientSessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(clientSessions.id, exceptSessionId));

  await db.update(clientSessions).set({ revokedAt: new Date() }).where(and(...conditions));
}

export async function revokeAllAdminSessions(adminId: string, exceptSessionId?: string): Promise<void> {
  const conditions = [eq(companyAdminSessions.adminId, adminId), isNull(companyAdminSessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(companyAdminSessions.id, exceptSessionId));

  await db.update(companyAdminSessions).set({ revokedAt: new Date() }).where(and(...conditions));
}

/** Housekeeping — removes rows that can never authenticate again. */
export async function purgeExpiredSessions(): Promise<void> {
  const cutoff = new Date();
  await db
    .delete(clientSessions)
    .where(or(lt(clientSessions.expiresAt, cutoff), lt(clientSessions.revokedAt, cutoff)));
  await db
    .delete(companyAdminSessions)
    .where(or(lt(companyAdminSessions.expiresAt, cutoff), lt(companyAdminSessions.revokedAt, cutoff)));
}
