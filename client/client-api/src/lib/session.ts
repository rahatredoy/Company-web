import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config/index';
import type { TenantDb } from '../db/tenant-manager';
import { adminSessions, customerSessions } from '../db/schema/index';
import { generateToken, sha256 } from './crypto';
import { SESSION_COOKIE } from './constants';
import { addDays, addMinutes, slugFromHost } from './utils';
import { clientIp, userAgent } from './http';

/**
 * Every cookie this API issues, named once.
 *
 * `customer` and `guestOrders` are handled here rather than in a module of their
 * own so they inherit `cookieDomain` — the per-store `.{slug}.{root}` scoping
 * that is the reason one store's session cannot be offered to another store's
 * origin. That function is deliberately not exported; a second implementation of
 * it is exactly the bug it exists to prevent.
 */
type Audience = 'admin' | 'adminMfa' | 'customer' | 'guestOrders';

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

const COOKIE_NAMES: Record<Audience, string> = {
  admin: SESSION_COOKIE.admin,
  adminMfa: SESSION_COOKIE.adminMfa,
  customer: SESSION_COOKIE.customer,
  guestOrders: SESSION_COOKIE.guestOrders,
};

function cookieName(audience: Audience): string {
  return COOKIE_NAMES[audience];
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

/**
 * Housekeeping — removes rows that can never authenticate again.
 *
 * Both families, not just the admin one. A store has a single admin signing in
 * once a day; it can have thousands of shoppers, each leaving a row behind on
 * every login. `customer_sessions` is where this table actually grows, and
 * leaving it out meant the sweep addressed the smaller half of the problem.
 *
 * Revoked rows are kept for a grace period rather than deleted the moment they
 * are revoked: a sign-out immediately followed by a request should read as "this
 * session ended", which needs the row, not as an unknown token.
 */
const REVOKED_GRACE_DAYS = 7;

export async function purgeExpiredSessions(db: TenantDb): Promise<{ admin: number; customer: number }> {
  const now = new Date();
  const revokedCutoff = addDays(now, -REVOKED_GRACE_DAYS);

  const admin = await db
    .delete(adminSessions)
    .where(or(lt(adminSessions.expiresAt, now), lt(adminSessions.revokedAt, revokedCutoff)))
    .returning({ id: adminSessions.id });

  const customer = await db
    .delete(customerSessions)
    .where(or(lt(customerSessions.expiresAt, now), lt(customerSessions.revokedAt, revokedCutoff)))
    .returning({ id: customerSessions.id });

  return { admin: admin.length, customer: customer.length };
}

// -------------------------------------------------------------- customers ----

/**
 * A shopper's session.
 *
 * The same construction as an admin's — opaque 32-byte token, only the SHA-256
 * stored, `tenant_ref` on the row — and deliberately none of the privileges.
 * `customer_sessions` has no `mfa_verified` and no `authenticated_at`, so there
 * is no challenge state to promote and no reauth window: a customer either has a
 * valid session or does not.
 *
 * A shopper's session is long by default. Being signed out of a shop mid-basket
 * is a lost sale, not a security win — the session unlocks an order history and
 * an address book, never a payment instrument.
 */
export async function createCustomerSession(
  db: TenantDb,
  request: FastifyRequest,
  input: { customerId: string; tenantRef: string; remember?: boolean },
): Promise<CreatedSession> {
  const token = generateToken(32);
  const remember = input.remember ?? true;
  const expiresAt = addDays(new Date(), config.security.sessionRememberTtlDays);

  const [row] = await db
    .insert(customerSessions)
    .values({
      customerId: input.customerId,
      tokenHash: sha256(token),
      tenantRef: input.tenantRef,
      remember,
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      expiresAt,
    })
    .returning({ id: customerSessions.id });

  return { id: row!.id, token, expiresAt };
}

export async function findCustomerSession(db: TenantDb, token: string) {
  const rows = await db
    .select()
    .from(customerSessions)
    .where(
      and(
        eq(customerSessions.tokenHash, sha256(token)),
        isNull(customerSessions.revokedAt),
        gt(customerSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Sliding expiry, same as the admin side. */
export async function touchCustomerSession(db: TenantDb, sessionId: string): Promise<void> {
  await db
    .update(customerSessions)
    .set({ lastSeenAt: new Date(), expiresAt: addDays(new Date(), config.security.sessionRememberTtlDays) })
    .where(eq(customerSessions.id, sessionId));
}

export async function revokeCustomerSession(db: TenantDb, sessionId: string): Promise<void> {
  await db
    .update(customerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(customerSessions.id, sessionId));
}

/** After a password change or reset — every other device is signed out. */
export async function revokeAllCustomerSessions(
  db: TenantDb,
  customerId: string,
  exceptSessionId?: string,
): Promise<void> {
  const conditions = [eq(customerSessions.customerId, customerId), isNull(customerSessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(customerSessions.id, exceptSessionId));
  await db.update(customerSessions).set({ revokedAt: new Date() }).where(and(...conditions));
}

/**
 * Sets a cookie whose lifetime is a fixed span rather than a session row's.
 *
 * Used for the guest-order token, which has no table behind it — its state lives
 * in Redis, and the cookie only has to survive long enough for someone to come
 * back to a receipt.
 */
export function setOpaqueCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  audience: Audience,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(cookieName(audience), token, { ...cookieOptions(request), expires: expiresAt });
}
