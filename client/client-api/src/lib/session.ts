import { createHmac } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config/index';
import { randomUUID } from './crypto';
import { redis } from './redis';
import { signJwt, verifyJwt } from './jwt';
import { AUTH_AUDIENCE, SESSION_COOKIE } from './constants';
import { addDays, addMinutes, slugFromHost } from './utils';
import { clientIp, userAgent } from './http';

/**
 * Sessions are **JWTs carried in HttpOnly cookies**, with a Redis record behind
 * each one that decides whether it is still live.
 *
 * The JWT answers "is this real, who is it for, and which store" — signature,
 * expiry, audience and tenant are all checked with no I/O, so a forged or
 * expired cookie is refused before Redis is asked anything. Redis answers "is it
 * still live": a JWT cannot be recalled once issued, and signing out, signing
 * out everywhere, and a password change ending every other login are exactly
 * that. `jti` names the record, and no record means no session.
 *
 * **Everything that changes lives in the record, never in the claims** — last
 * seen, the reauth stamp, remember-me — because a claim that moves is a claim
 * that goes stale in a cookie this API cannot reach.
 *
 * Two things are specific to this side of the platform:
 *
 * - **A record is keyed under the tenant**, so one store's session cannot be
 *   read, listed or revoked through another store's request even if a `jti` were
 *   guessed. The tenant also rides in the claims, and `requireStoreAdmin`
 *   compares it against the host — belt and braces, because a store's identity
 *   is the whole of this API's isolation model.
 * - **`guestOrders` is not a session and is not a JWT.** It authorises reading
 *   the confirmation page for orders this browser actually placed, carries no
 *   claims and identifies nobody, so it stays the opaque token it always was.
 *   It is handled here only to inherit `cookieDomain`.
 *
 * Sliding expiry is the one place this is more work than a database row: a JWT's
 * expiry is signed into it, so extending a session means **minting a new token
 * for the same `jti`** — which is why `touch*` returns a token for the caller to
 * write back.
 */

const ISSUER = 'client-api';

/** Every cookie this API issues, named once. */
type Audience = 'admin' | 'adminMfa' | 'customer' | 'guestOrders';

/** The three that are actually JWT sessions. `guestOrders` is not one. */
type SessionAudience = Exclude<Audience, 'guestOrders'>;

/** Which principal a record belongs to. Revoking every session revokes both kinds. */
type Family = 'admin' | 'customer';

const JWT_AUDIENCE: Record<SessionAudience, string> = {
  admin: AUTH_AUDIENCE.admin,
  adminMfa: AUTH_AUDIENCE.adminMfa,
  customer: AUTH_AUDIENCE.customer,
};

const FAMILY_OF: Record<SessionAudience, Family> = {
  admin: 'admin',
  adminMfa: 'admin',
  customer: 'customer',
};

/**
 * One configured secret, two derived keys.
 *
 * A store admin and a shopper are the most and least privileged principals this
 * API has, and signing both with the same key would leave only the audience
 * claim between them. Deriving a key per family means a customer's token is not
 * merely labelled differently — it cannot be verified as an admin's at all, so a
 * mistake in the audience check is not enough on its own to promote anybody.
 */
function familySecret(family: Family): string {
  return createHmac('sha256', config.security.storeAuthSecret)
    .update(`session-key:${family}`, 'utf8')
    .digest('base64url');
}

const SECRET_OF: Record<Family, string> = {
  admin: familySecret('admin'),
  customer: familySecret('customer'),
};

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

// ------------------------------------------------------------------ record ---

/**
 * What Redis holds for a live session. Timestamps are epoch milliseconds because
 * this is JSON — a `Date` would come back as a string and quietly compare wrong.
 */
interface SessionRecord {
  sub: string;
  tenantRef: string;
  audience: SessionAudience;
  /** False on an MFA challenge, which can never satisfy `requireStoreAdmin`. */
  verified: boolean;
  remember: boolean;
  ip: string | null;
  ua: string | null;
  createdAt: number;
  lastSeenAt: number;
  /** Last password proof — sensitive actions require a recent value. */
  authenticatedAt: number;
  expiresAt: number;
}

/**
 * The shape the guards and routes read.
 *
 * Every instant is handed back as a `Date` and every id under the name of the
 * column it replaces, so a call site reads exactly as it did against the table.
 */
export type LoadedSession = Omit<
  SessionRecord,
  'createdAt' | 'lastSeenAt' | 'authenticatedAt' | 'expiresAt'
> & {
  id: string;
  adminId: string;
  customerId: string;
  mfaVerified: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  authenticatedAt: Date;
  expiresAt: Date;
};

/**
 * Tenant-scoped, matching `lib/cache.ts#tenantKey`: an entry can never be shared
 * between two stores, and one store's request cannot name another's key.
 */
function recordKey(tenantRef: string, family: Family, jti: string): string {
  return `t:${tenantRef}:session:${family}:${jti}`;
}

/**
 * Every live `jti` for one principal, so "sign out everywhere" does not have to
 * scan the keyspace. Pruned whenever it is read.
 *
 * The name is duplicated in `company-api/src/services/store-admin.ts`, which
 * ends every open panel session when it rewrites the store admin's password
 * across the platform boundary. The two must be changed together — the same
 * arrangement, and for the same reason, as the `tenant:v2:invalidate` channel.
 */
function indexKey(tenantRef: string, family: Family, sub: string): string {
  return `t:${tenantRef}:session-index:${family}:${sub}`;
}

function ttlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

async function writeRecord(jti: string, record: SessionRecord): Promise<void> {
  const family = FAMILY_OF[record.audience];
  const ttl = ttlSeconds(record.expiresAt);
  const index = indexKey(record.tenantRef, family, record.sub);

  await redis
    .multi()
    .set(recordKey(record.tenantRef, family, jti), JSON.stringify(record), 'EX', ttl)
    .sadd(index, jti)
    // The index must outlive its longest member, or "sign out everywhere" starts
    // missing sessions that are still perfectly valid.
    .expire(index, ttl + 86_400)
    .exec();
}

async function readRecord(tenantRef: string, family: Family, jti: string): Promise<SessionRecord | null> {
  const raw = await redis.get(recordKey(tenantRef, family, jti));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

function loaded(jti: string, record: SessionRecord): LoadedSession {
  return {
    ...record,
    id: jti,
    adminId: record.sub,
    customerId: record.sub,
    mfaVerified: record.verified,
    createdAt: new Date(record.createdAt),
    lastSeenAt: new Date(record.lastSeenAt),
    authenticatedAt: new Date(record.authenticatedAt),
    expiresAt: new Date(record.expiresAt),
  };
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: Date;
}

/** Mints a token for an existing `jti` — the sliding-expiry and rotation path. */
function issue(jti: string, record: SessionRecord): string {
  return signJwt({
    secret: SECRET_OF[FAMILY_OF[record.audience]],
    issuer: ISSUER,
    audience: JWT_AUDIENCE[record.audience],
    subject: record.sub,
    jwtId: jti,
    expiresAt: new Date(record.expiresAt),
    // Signed rather than merely recorded: a token names the store it was minted
    // for, so a cross-tenant replay is refused by the claim as well as by the
    // key it would have to be found under.
    claims: { tnt: record.tenantRef },
  });
}

/**
 * `null` where a request would be, for the scratch and verification scripts:
 * they render real pages but have no inbound request to attribute a session to,
 * and inventing one would put a fabricated IP on the record.
 */
type Attribution = FastifyRequest | null;

async function create(
  request: Attribution,
  audience: SessionAudience,
  input: { sub: string; tenantRef: string; verified: boolean; remember: boolean; expiresAt: Date },
): Promise<CreatedSession> {
  const jti = randomUUID();
  const now = Date.now();

  const record: SessionRecord = {
    sub: input.sub,
    tenantRef: input.tenantRef,
    audience,
    verified: input.verified,
    remember: input.remember,
    ip: request ? clientIp(request) || null : null,
    ua: request ? userAgent(request) || null : null,
    createdAt: now,
    lastSeenAt: now,
    authenticatedAt: now,
    expiresAt: input.expiresAt.getTime(),
  };

  await writeRecord(jti, record);
  return { id: jti, token: issue(jti, record), expiresAt: new Date(record.expiresAt) };
}

/**
 * Verifies a token and loads what it names.
 *
 * The audiences are tried in turn because one cookie can legitimately hold
 * either kind during sign-in, and only the signature can say which this is. A
 * token that verifies but names no record has been revoked or has expired out of
 * Redis, and is refused exactly like a forged one.
 */
async function resolve(
  tenantRef: string,
  token: string,
  audiences: readonly SessionAudience[],
): Promise<LoadedSession | null> {
  for (const audience of audiences) {
    const family = FAMILY_OF[audience];
    const claims = verifyJwt(token, {
      secret: SECRET_OF[family],
      issuer: ISSUER,
      audience: JWT_AUDIENCE[audience],
    });
    if (!claims) continue;
    if (claims.tnt !== tenantRef) return null;

    const record = await readRecord(tenantRef, family, claims.jti);
    if (!record) return null;
    // A record reached by a token of another audience would mean two audiences
    // shared a `jti`; refuse rather than trust the record over the signature.
    if (record.audience !== audience || record.sub !== claims.sub) return null;
    if (record.tenantRef !== tenantRef) return null;

    return loaded(claims.jti, record);
  }
  return null;
}

async function patch(
  tenantRef: string,
  family: Family,
  jti: string,
  changes: Partial<SessionRecord>,
): Promise<SessionRecord | null> {
  const record = await readRecord(tenantRef, family, jti);
  if (!record) return null;

  const next = { ...record, ...changes };
  await writeRecord(jti, next);
  return next;
}

async function destroy(tenantRef: string, family: Family, jti: string): Promise<void> {
  const record = await readRecord(tenantRef, family, jti);
  await redis.del(recordKey(tenantRef, family, jti));
  if (record) await redis.srem(indexKey(tenantRef, family, record.sub), jti);
}

/**
 * Every live session for one principal, newest first — and the pruning pass for
 * the index that lists them.
 */
async function listFor(tenantRef: string, family: Family, sub: string): Promise<LoadedSession[]> {
  const index = indexKey(tenantRef, family, sub);
  const ids = await redis.smembers(index);
  if (ids.length === 0) return [];

  const raws = await redis.mget(ids.map((jti) => recordKey(tenantRef, family, jti)));
  const live: LoadedSession[] = [];
  const dead: string[] = [];

  ids.forEach((jti, position) => {
    const raw = raws[position];
    if (!raw) {
      dead.push(jti);
      return;
    }
    try {
      live.push(loaded(jti, JSON.parse(raw) as SessionRecord));
    } catch {
      dead.push(jti);
    }
  });

  if (dead.length > 0) await redis.srem(index, ...dead);

  return live.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

async function revokeEvery(
  tenantRef: string,
  family: Family,
  sub: string,
  exceptJti?: string,
): Promise<void> {
  const index = indexKey(tenantRef, family, sub);
  const ids = await redis.smembers(index);
  const doomed = ids.filter((jti) => jti !== exceptJti);
  if (doomed.length === 0) return;

  await redis.del(...doomed.map((jti) => recordKey(tenantRef, family, jti)));
  await redis.srem(index, ...doomed);
}

// ------------------------------------------------------------- store admin ---

function sessionExpiry(mfaVerified: boolean, remember: boolean): Date {
  if (!mfaVerified) return addMinutes(new Date(), config.security.mfaChallengeTtlMinutes);
  return remember
    ? addDays(new Date(), config.security.sessionRememberTtlDays)
    : addMinutes(new Date(), config.security.sessionTtlMinutes);
}

/**
 * A store admin's session.
 *
 * Two things make one unusable anywhere else on the platform: the audience and
 * signing key are this API's alone, so no company-side token can be presented
 * here and none of these can be presented there; and the token names its store,
 * so it is refused by any other store's host before a record is even looked for.
 *
 * A session created with `mfaVerified: false` is an MFA *challenge* — it is set
 * under a different cookie, minted under an audience of its own, expires in
 * minutes, and can never satisfy `requireStoreAdmin`.
 */
export async function createAdminSession(
  request: Attribution,
  input: { adminId: string; tenantRef: string; mfaVerified: boolean; remember: boolean },
): Promise<CreatedSession> {
  return create(request, input.mfaVerified ? 'admin' : 'adminMfa', {
    sub: input.adminId,
    tenantRef: input.tenantRef,
    verified: input.mfaVerified,
    remember: input.remember,
    expiresAt: sessionExpiry(input.mfaVerified, input.remember),
  });
}

/**
 * Privilege elevation once MFA succeeds.
 *
 * The challenge record is **destroyed** and a new one minted under the full
 * audience, so neither the old token nor its id can be replayed (session
 * fixation), and the session extends from the short challenge TTL to a full one.
 */
export async function promoteAdminSession(
  tenantRef: string,
  sessionId: string,
  remember: boolean,
): Promise<CreatedSession | null> {
  const record = await readRecord(tenantRef, 'admin', sessionId);
  if (!record) return null;

  const jti = randomUUID();
  const now = Date.now();
  const next: SessionRecord = {
    ...record,
    audience: 'admin',
    verified: true,
    remember,
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: sessionExpiry(true, remember).getTime(),
  };

  await writeRecord(jti, next);
  await destroy(tenantRef, 'admin', sessionId);

  return { id: jti, token: issue(jti, next), expiresAt: new Date(next.expiresAt) };
}

/**
 * The single writer of `authenticatedAt` for an already-verified session — this
 * is what makes a `REAUTH_REQUIRED` response recoverable instead of a dead end.
 */
export async function refreshSessionAuth(
  tenantRef: string,
  sessionId: string,
  remember: boolean,
): Promise<void> {
  const now = Date.now();
  await patch(tenantRef, 'admin', sessionId, {
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: sessionExpiry(true, remember).getTime(),
  });
}

/** Login hygiene: drop MFA challenges that were started and never completed. */
export async function revokeUnverifiedSessions(tenantRef: string, adminId: string): Promise<void> {
  for (const session of await listFor(tenantRef, 'admin', adminId)) {
    if (!session.verified) await destroy(tenantRef, 'admin', session.id);
  }
}

export async function findAdminSession(tenantRef: string, token: string): Promise<LoadedSession | null> {
  return resolve(tenantRef, token, ['admin', 'adminMfa']);
}

/**
 * Sliding expiry. Returns a **new token** as well as the new expiry: a JWT's
 * lifetime is signed into it, so re-writing the old string would slide the
 * cookie without sliding the session and sign the admin out anyway.
 */
export async function touchAdminSession(
  tenantRef: string,
  sessionId: string,
  remember: boolean,
): Promise<{ token: string; expiresAt: Date } | null> {
  const expiresAt = sessionExpiry(true, remember);
  const next = await patch(tenantRef, 'admin', sessionId, {
    lastSeenAt: Date.now(),
    expiresAt: expiresAt.getTime(),
  });
  if (!next) return null;

  return { token: issue(sessionId, next), expiresAt };
}

export async function revokeSession(tenantRef: string, sessionId: string): Promise<void> {
  await destroy(tenantRef, 'admin', sessionId);
}

/** Used after a password change or a disable: every other device is signed out. */
export async function revokeAllSessions(
  tenantRef: string,
  adminId: string,
  exceptSessionId?: string,
): Promise<void> {
  await revokeEvery(tenantRef, 'admin', adminId, exceptSessionId);
}

export async function listAdminSessions(tenantRef: string, adminId: string): Promise<LoadedSession[]> {
  return listFor(tenantRef, 'admin', adminId);
}

// --------------------------------------------------------------- customers ---

/**
 * A shopper's session.
 *
 * The same construction as an admin's — a JWT naming a Redis record — and
 * deliberately none of the privileges: a different signing key, a different
 * audience, no MFA state to promote and no reauth window. A customer either has
 * a valid session or does not.
 *
 * A shopper's session is long by default. Being signed out of a shop mid-basket
 * is a lost sale, not a security win — the session unlocks an order history and
 * an address book, never a payment instrument.
 */
export async function createCustomerSession(
  request: Attribution,
  input: { customerId: string; tenantRef: string; remember?: boolean },
): Promise<CreatedSession> {
  return create(request, 'customer', {
    sub: input.customerId,
    tenantRef: input.tenantRef,
    verified: true,
    remember: input.remember ?? true,
    expiresAt: addDays(new Date(), config.security.sessionRememberTtlDays),
  });
}

export async function findCustomerSession(tenantRef: string, token: string): Promise<LoadedSession | null> {
  return resolve(tenantRef, token, ['customer']);
}

/** Sliding expiry, same as the admin side and for the same reason. */
export async function touchCustomerSession(
  tenantRef: string,
  sessionId: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const expiresAt = addDays(new Date(), config.security.sessionRememberTtlDays);
  const next = await patch(tenantRef, 'customer', sessionId, {
    lastSeenAt: Date.now(),
    expiresAt: expiresAt.getTime(),
  });
  if (!next) return null;

  return { token: issue(sessionId, next), expiresAt };
}

export async function revokeCustomerSession(tenantRef: string, sessionId: string): Promise<void> {
  await destroy(tenantRef, 'customer', sessionId);
}

/** After a password change or reset — every other device is signed out. */
export async function revokeAllCustomerSessions(
  tenantRef: string,
  customerId: string,
  exceptSessionId?: string,
): Promise<void> {
  await revokeEvery(tenantRef, 'customer', customerId, exceptSessionId);
}

export async function listCustomerSessions(
  tenantRef: string,
  customerId: string,
): Promise<LoadedSession[]> {
  return listFor(tenantRef, 'customer', customerId);
}

// ----------------------------------------------------------------- cookies ---

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

/**
 * Sets a cookie whose lifetime is a fixed span rather than a session record's.
 *
 * Used for the guest-order token, which is deliberately **not** a JWT and not a
 * session: it identifies nobody, carries no claims, and only authorises reading
 * the receipts this browser actually created. Its state is a Redis set keyed by
 * the token's own hash, so signing it would add a second answer to a question
 * that already has one.
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

// ------------------------------------------------------------ housekeeping ---

/**
 * Records expire on their own — Redis holds each for exactly as long as its
 * token is valid. What outlives them is the per-principal index, which keeps
 * naming sessions that are already gone, so this walks the index keys and drops
 * the dead members.
 *
 * Platform-wide rather than per tenant: the keys are already tenant-scoped, and
 * one `SCAN` over the shared Redis costs far less than a pass per store. `SCAN`
 * rather than `KEYS` because that Redis also carries the company platform and
 * both BullMQ queues.
 */
export async function purgeExpiredSessions(): Promise<number> {
  let cursor = '0';
  let pruned = 0;

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 't:*:session-index:*', 'COUNT', 200);
    cursor = next;

    for (const key of keys) {
      const ids = await redis.smembers(key);
      if (ids.length === 0) continue;

      // t:<tenantRef>:session-index:<family>:<sub>
      const [, tenantRef, , family] = key.split(':') as [string, string, string, Family, string];
      const raws = await redis.mget(ids.map((jti) => recordKey(tenantRef, family, jti)));
      const dead = ids.filter((_, position) => !raws[position]);

      if (dead.length > 0) {
        await redis.srem(key, ...dead);
        pruned += dead.length;
      }
    }
  } while (cursor !== '0');

  return pruned;
}
