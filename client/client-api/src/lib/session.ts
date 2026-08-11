import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config/index';
import type { TenantDb } from '../db/tenant-manager';
import { adminSessions } from '../db/schema/index';
import { generateToken, sha256 } from './crypto';
import { SESSION_COOKIE } from './constants';
import { addDays, addMinutes, slugFromHost } from './utils';
import { clientIp, userAgent } from './http';

type Audience = 'admin' | 'adminMfa';

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  path: '/',
};

/**
 * Scopes the cookie to one store, never to the platform.
 *
 * The panel (`admin.<slug>.company.com`) and the API (`api.<slug>.company.com`)
 * are different hosts, so a host-only cookie set by the API would never reach
 * the panel's own server render. The fix is a cookie scoped to
 * `.<slug>.company.com` — which reaches both, and **only** that store's
 * hostnames. Scoping to `.company.com` instead would offer one store's session
 * cookie to every other store's origin, so the platform root is explicitly
 * refused here rather than left to configuration.
 *
 * A single-host or custom-domain deployment gets a host-only cookie, which is
 * already correct.
 */
function cookieDomain(request: FastifyRequest): string | undefined {
  if (config.security.cookieDomain) return config.security.cookieDomain;

  const host = (request.headers.host ?? '').split(':')[0]!.toLowerCase();
  const root = config.urls.platformRootDomain;
  if (!host.endsWith(`.${root}`)) return undefined;

  const slug = slugFromHost(host, root);
  return slug ? `.${slug}.${root}` : undefined;
}

function cookieOptions(request: FastifyRequest) {
  const domain = cookieDomain(request);
  return { ...COOKIE_BASE, ...(domain ? { domain } : {}) };
}

function cookieName(audience: Audience): string {
  return audience === 'adminMfa' ? SESSION_COOKIE.adminMfa : SESSION_COOKIE.admin;
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: Date;
}

/**
 * Store-admin sessions are opaque 32-byte tokens; only the SHA-256 is stored, so
 * a dump of `admin_sessions` cannot be replayed as a login.
 *
 * Two things make these unusable anywhere else on the platform: the cookie name
 * (`store_admin_session`) is distinct from every company-side cookie, and the row
 * lives in the tenant's own database and carries `tenant_ref`. A token minted for
 * one store is simply absent from another store's table.
 *
 * A session created with `mfaVerified: false` is an MFA *challenge* — it is set
 * under a different cookie, expires in minutes, and can never satisfy
 * `requireStoreAdmin`.
 */
export async function createAdminSession(
  db: TenantDb,
  request: FastifyRequest,
  input: { adminId: string; tenantRef: string; mfaVerified: boolean; remember: boolean },
): Promise<CreatedSession> {
  const token = generateToken(32);
  const expiresAt = sessionExpiry(input.mfaVerified, input.remember);

  const [row] = await db
    .insert(adminSessions)
    .values({
      adminId: input.adminId,
      tokenHash: sha256(token),
      tenantRef: input.tenantRef,
      mfaVerified: input.mfaVerified,
      remember: input.remember,
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      expiresAt,
    })
    .returning({ id: adminSessions.id });

  return { id: row!.id, token, expiresAt };
}

function sessionExpiry(mfaVerified: boolean, remember: boolean): Date {
  if (!mfaVerified) return addMinutes(new Date(), config.security.mfaChallengeTtlMinutes);
  return remember
    ? addDays(new Date(), config.security.sessionRememberTtlDays)
    : addMinutes(new Date(), config.security.sessionTtlMinutes);
}

/**
 * Privilege elevation once MFA succeeds. The token is **rotated** so the pre-MFA
 * value cannot be replayed (session fixation), and the session extends from the
 * short challenge TTL to a full one.
 */
export async function promoteAdminSession(
  db: TenantDb,
  sessionId: string,
  remember: boolean,
): Promise<CreatedSession> {
  const token = generateToken(32);
  const expiresAt = sessionExpiry(true, remember);
  const now = new Date();

  await db
    .update(adminSessions)
    .set({
      tokenHash: sha256(token),
      mfaVerified: true,
      remember,
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .where(eq(adminSessions.id, sessionId));

  return { id: sessionId, token, expiresAt };
}

/**
 * The single writer of `authenticatedAt` for an already-verified session — this
 * is what makes a `REAUTH_REQUIRED` response recoverable instead of a dead end.
 */
export async function refreshSessionAuth(db: TenantDb, sessionId: string, remember: boolean): Promise<void> {
  const now = new Date();
  await db
    .update(adminSessions)
    .set({ authenticatedAt: now, lastSeenAt: now, expiresAt: sessionExpiry(true, remember) })
    .where(eq(adminSessions.id, sessionId));
}

/** Login hygiene: drop MFA challenges that were started and never completed. */
export async function revokeUnverifiedSessions(db: TenantDb, adminId: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(adminSessions.adminId, adminId),
        eq(adminSessions.mfaVerified, false),
        isNull(adminSessions.revokedAt),
      ),
    );
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  audience: Audience,
  session: CreatedSession,
): void {
  reply.setCookie(cookieName(audience), session.token, {
    ...cookieOptions(request),
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  audience: Audience,
): void {
  // Must carry the same domain it was set with, or the browser keeps the old one.
  reply.clearCookie(cookieName(audience), cookieOptions(request));
}

export function readSessionToken(request: FastifyRequest, audience: Audience): string | null {
  const raw = request.cookies?.[cookieName(audience)];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export async function findAdminSession(db: TenantDb, token: string) {
  const rows = await db
    .select()
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.tokenHash, sha256(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Sliding expiry: every authenticated request pushes the session forward. */
export async function touchAdminSession(db: TenantDb, sessionId: string, remember: boolean): Promise<void> {
  await db
    .update(adminSessions)
    .set({ lastSeenAt: new Date(), expiresAt: sessionExpiry(true, remember) })
    .where(eq(adminSessions.id, sessionId));
}

export async function revokeSession(db: TenantDb, sessionId: string): Promise<void> {
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, sessionId));
}

/** Used after a password change or a disable: every other device is signed out. */
export async function revokeAllSessions(
  db: TenantDb,
  adminId: string,
  exceptSessionId?: string,
): Promise<void> {
  const conditions = [eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(adminSessions.id, exceptSessionId));
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(and(...conditions));
}

/** Housekeeping — removes rows that can never authenticate again. */
export async function purgeExpiredSessions(db: TenantDb): Promise<void> {
  const cutoff = new Date();
  await db
    .delete(adminSessions)
    .where(or(lt(adminSessions.expiresAt, cutoff), lt(adminSessions.revokedAt, cutoff)));
}
