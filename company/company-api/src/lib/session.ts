import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config/index';
import { randomUUID } from './crypto';
import { redis } from './redis';
import { signJwt, verifyJwt } from './jwt';
import { AUTH_AUDIENCE, SESSION_COOKIE } from './constants';
import { addDays, addMinutes } from './utils';
import { clientIp, userAgent } from './http';

/**
 * Sessions are **JWTs carried in HttpOnly cookies**, with a Redis record behind
 * each one that decides whether it is still live.
 *
 * The split is the whole design, so it is worth being precise about which half
 * answers what:
 *
 * - **The JWT answers "is this real, and who is it for".** Signature, expiry and
 *   audience are checked with no I/O at all, so a forged, expired or
 *   wrong-audience cookie is refused before anything is asked of Redis. The
 *   audience is what separates a half-finished sign-in from a real one: a
 *   challenge token is minted under its own audience and is not merely rejected
 *   by a protected route, it fails to verify there at all.
 * - **Redis answers "is it still live, and what has it done since".** A JWT
 *   cannot be recalled once issued, which is the one thing a session must be
 *   able to do — sign out, sign out everywhere, a password change ending every
 *   other login. So `jti` names a record, and no record means no session. That
 *   costs one round trip to a Redis this API already talks to on every request.
 *
 * **Everything that changes lives in the record, never in the claims.** Last
 * seen, the reauth stamp, remember-me, and the passcode challenge all move
 * during a session's life, and a claim that moves is a claim that goes stale in
 * a cookie the API cannot reach. The token therefore carries only what is fixed
 * for its whole life: subject, audience, id, and expiry.
 *
 * Sliding expiry is the one place this is more work than a database row. A JWT's
 * expiry is signed into it, so extending a session means **minting a new token
 * for the same `jti`** — which is why `touch*` returns a token for the caller to
 * write back, rather than returning nothing.
 */

const ISSUER = 'company-api';

/** Full sessions and the challenges that precede them. Audiences never overlap. */
type Audience = 'client' | 'clientOtp' | 'admin' | 'adminOtp';

/** Not a session — see `lib/trusted-device.ts`. Kept here to share `COOKIE_BASE`. */
type DeviceAudience = 'adminDevice';

/** Which user a record belongs to. Revoking every session revokes both kinds. */
type Family = 'client' | 'admin';

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

const JWT_AUDIENCE: Record<Audience, string> = {
  client: AUTH_AUDIENCE.client,
  clientOtp: AUTH_AUDIENCE.clientOtp,
  admin: AUTH_AUDIENCE.admin,
  adminOtp: AUTH_AUDIENCE.adminOtp,
};

const FAMILY_OF: Record<Audience, Family> = {
  client: 'client',
  clientOtp: 'client',
  admin: 'admin',
  adminOtp: 'admin',
};

/**
 * Each family signs with its own secret, so a client token and an admin token
 * are not merely labelled differently — neither can be verified with the other's
 * key. The audience check is the second lock on the same door.
 */
const SECRET_OF: Record<Family, string> = {
  client: config.security.clientAuthSecret,
  admin: config.security.adminAuthSecret,
};

function cookieName(audience: Audience): string {
  return SESSION_COOKIE[audience];
}

// ------------------------------------------------------------------ record ---

/**
 * What Redis holds for a live session. Timestamps are epoch milliseconds because
 * this is JSON — a `Date` would come back as a string and quietly compare wrong.
 */
interface SessionRecord {
  sub: string;
  audience: Audience;
  verified: boolean;
  remember: boolean;
  ip: string | null;
  ua: string | null;
  createdAt: number;
  lastSeenAt: number;
  /** Last password proof — sensitive actions require a recent value. */
  authenticatedAt: number;
  expiresAt: number;
  /**
   * The passcode rides on the challenge record, which is what makes it
   * single-use and scoped to one sign-in attempt: it dies with the challenge it
   * was issued for, and a code minted for one attempt is simply not present on
   * any other.
   */
  otpCodeHash: string | null;
  otpExpiresAt: number | null;
  otpSentAt: number | null;
  otpAttempts: number;
}

/**
 * The shape the guards and routes read.
 *
 * Every instant is handed back as a `Date` and every id under the name of the
 * column it replaces, so a call site reads exactly as it did against the table.
 * The epoch-millisecond form is an artefact of storing the record as JSON and
 * does not escape this module.
 */
export type LoadedSession = Omit<
  SessionRecord,
  'createdAt' | 'lastSeenAt' | 'authenticatedAt' | 'expiresAt' | 'otpExpiresAt' | 'otpSentAt'
> & {
  id: string;
  clientAccountId: string;
  adminId: string;
  otpVerified: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  authenticatedAt: Date;
  expiresAt: Date;
  otpExpiresAt: Date | null;
  otpSentAt: Date | null;
};

function recordKey(family: Family, jti: string): string {
  return `session:${family}:${jti}`;
}

/**
 * Every live `jti` for one user, so "sign out everywhere" does not have to scan
 * the keyspace. Pruned whenever it is read — a member whose record has expired
 * is simply dropped.
 */
function indexKey(family: Family, sub: string): string {
  return `session-index:${family}:${sub}`;
}

function ttlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

async function writeRecord(jti: string, record: SessionRecord): Promise<void> {
  const family = FAMILY_OF[record.audience];
  const ttl = ttlSeconds(record.expiresAt);

  await redis
    .multi()
    .set(recordKey(family, jti), JSON.stringify(record), 'EX', ttl)
    .sadd(indexKey(family, record.sub), jti)
    // The index must outlive its longest member, or "sign out everywhere" starts
    // missing sessions that are still perfectly valid.
    .expire(indexKey(family, record.sub), ttl + 86_400)
    .exec();
}

async function readRecord(family: Family, jti: string): Promise<SessionRecord | null> {
  const raw = await redis.get(recordKey(family, jti));
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
    clientAccountId: record.sub,
    adminId: record.sub,
    otpVerified: record.verified,
    createdAt: new Date(record.createdAt),
    lastSeenAt: new Date(record.lastSeenAt),
    authenticatedAt: new Date(record.authenticatedAt),
    expiresAt: new Date(record.expiresAt),
    otpExpiresAt: record.otpExpiresAt === null ? null : new Date(record.otpExpiresAt),
    otpSentAt: record.otpSentAt === null ? null : new Date(record.otpSentAt),
  };
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: Date;
}

/** Mints a token for an existing `jti` — the sliding-expiry and rotation path. */
function issue(jti: string, record: SessionRecord): string {
  const family = FAMILY_OF[record.audience];
  return signJwt({
    secret: SECRET_OF[family],
    issuer: ISSUER,
    audience: JWT_AUDIENCE[record.audience],
    subject: record.sub,
    jwtId: jti,
    expiresAt: new Date(record.expiresAt),
  });
}

/**
 * `null` where a request would be, for the setup and verification scripts: they
 * drive the real HTTP flow but have no inbound request of their own to attribute
 * a session to, and inventing one would put a fabricated IP on the record.
 */
type Attribution = FastifyRequest | null;

async function create(
  request: Attribution,
  audience: Audience,
  sub: string,
  expiresAt: Date,
  overrides: Partial<SessionRecord> = {},
): Promise<CreatedSession> {
  const jti = randomUUID();
  const now = Date.now();

  const record: SessionRecord = {
    sub,
    audience,
    verified: audience === 'client' || audience === 'admin',
    remember: false,
    ip: request ? clientIp(request) || null : null,
    ua: request ? userAgent(request) || null : null,
    createdAt: now,
    lastSeenAt: now,
    authenticatedAt: now,
    expiresAt: expiresAt.getTime(),
    otpCodeHash: null,
    otpExpiresAt: null,
    otpSentAt: null,
    otpAttempts: 0,
    ...overrides,
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
async function resolve(token: string, audiences: readonly Audience[]): Promise<LoadedSession | null> {
  for (const audience of audiences) {
    const family = FAMILY_OF[audience];
    const claims = verifyJwt(token, {
      secret: SECRET_OF[family],
      issuer: ISSUER,
      audience: JWT_AUDIENCE[audience],
    });
    if (!claims) continue;

    const record = await readRecord(family, claims.jti);
    if (!record) return null;
    // A record reached by a token of another audience would mean two audiences
    // shared a `jti`; refuse rather than trust the record over the signature.
    if (record.audience !== audience || record.sub !== claims.sub) return null;

    return loaded(claims.jti, record);
  }
  return null;
}

async function loadById(family: Family, jti: string): Promise<LoadedSession | null> {
  const record = await readRecord(family, jti);
  return record ? loaded(jti, record) : null;
}

async function patch(
  family: Family,
  jti: string,
  changes: Partial<SessionRecord>,
): Promise<SessionRecord | null> {
  const record = await readRecord(family, jti);
  if (!record) return null;

  const next = { ...record, ...changes };
  await writeRecord(jti, next);
  return next;
}

async function destroy(family: Family, jti: string): Promise<void> {
  const record = await readRecord(family, jti);
  await redis.del(recordKey(family, jti));
  if (record) await redis.srem(indexKey(family, record.sub), jti);
}

/**
 * Every live session for one user, newest first — and the pruning pass for the
 * index that lists them.
 */
async function listSessions(family: Family, sub: string): Promise<LoadedSession[]> {
  const ids = await redis.smembers(indexKey(family, sub));
  if (ids.length === 0) return [];

  const raws = await redis.mget(ids.map((jti) => recordKey(family, jti)));
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

  if (dead.length > 0) await redis.srem(indexKey(family, sub), ...dead);

  return live.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

async function revokeAll(family: Family, sub: string, exceptJti?: string): Promise<void> {
  const ids = await redis.smembers(indexKey(family, sub));
  const doomed = ids.filter((jti) => jti !== exceptJti);
  if (doomed.length === 0) return;

  await redis.del(...doomed.map((jti) => recordKey(family, jti)));
  await redis.srem(indexKey(family, sub), ...doomed);
}

async function revokeUnverified(family: Family, sub: string): Promise<void> {
  for (const session of await listSessions(family, sub)) {
    if (!session.verified) await destroy(family, session.id);
  }
}

// ------------------------------------------------------------------ client ---

function clientSessionExpiry(remember: boolean): Date {
  return remember
    ? addDays(new Date(), config.security.sessionRememberTtlDays)
    : addMinutes(new Date(), config.security.sessionTtlMinutes);
}

/**
 * A session created with `otpVerified: false` is a sign-in *challenge*: it is
 * minted under its own audience, expires in minutes, and cannot be verified
 * against a protected route at all.
 */
export async function createClientSession(
  request: Attribution,
  clientAccountId: string,
  remember: boolean,
  options: { otpVerified: boolean; otpCodeHash?: string; otpExpiresAt?: Date } = { otpVerified: true },
): Promise<CreatedSession> {
  const expiresAt = options.otpVerified
    ? clientSessionExpiry(remember)
    : addMinutes(new Date(), config.security.otpChallengeTtlMinutes);

  return create(request, options.otpVerified ? 'client' : 'clientOtp', clientAccountId, expiresAt, {
    remember,
    otpCodeHash: options.otpCodeHash ?? null,
    otpExpiresAt: options.otpExpiresAt?.getTime() ?? null,
    otpSentAt: options.otpCodeHash ? Date.now() : null,
  });
}

/** Issues a fresh passcode against an existing client challenge (the resend path). */
export async function replaceClientSessionOtp(
  sessionId: string,
  codeHash: string,
  expiresAt: Date,
): Promise<void> {
  // Attempts reset with the code: guesses against a dead code must not count
  // against the new one.
  await patch('client', sessionId, {
    otpCodeHash: codeHash,
    otpExpiresAt: expiresAt.getTime(),
    otpSentAt: Date.now(),
    otpAttempts: 0,
  });
}

/** Records a failed guess and reports the running total. */
export async function registerClientOtpAttempt(sessionId: string): Promise<number> {
  const record = await readRecord('client', sessionId);
  if (!record) return 0;

  const attempts = record.otpAttempts + 1;
  await writeRecord(sessionId, { ...record, otpAttempts: attempts });
  return attempts;
}

/**
 * Promotion once the passcode is accepted.
 *
 * The challenge record is **destroyed** and a new one minted under the full
 * audience, so neither the old token nor its id can be replayed (session
 * fixation), and the passcode goes with it.
 */
export async function promoteClientSession(
  sessionId: string,
  remember: boolean,
): Promise<CreatedSession | null> {
  const record = await readRecord('client', sessionId);
  if (!record) return null;

  const jti = randomUUID();
  const now = Date.now();
  const next: SessionRecord = {
    ...record,
    audience: 'client',
    verified: true,
    remember,
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: clientSessionExpiry(remember).getTime(),
    otpCodeHash: null,
    otpExpiresAt: null,
    otpSentAt: null,
    otpAttempts: 0,
  };

  await writeRecord(jti, next);
  await destroy('client', sessionId);

  return { id: jti, token: issue(jti, next), expiresAt: new Date(next.expiresAt) };
}

/** Login hygiene: drop challenges that were started and never completed. */
export async function revokeUnverifiedClientSessions(clientAccountId: string): Promise<void> {
  await revokeUnverified('client', clientAccountId);
}

export async function findClientSession(token: string): Promise<LoadedSession | null> {
  return resolve(token, ['client', 'clientOtp']);
}

/** Loads a client session by id, for the OTP step which already knows which one it is. */
export async function findClientSessionById(sessionId: string): Promise<LoadedSession | null> {
  return loadById('client', sessionId);
}

/**
 * Sliding expiry. Returns a **new token** as well as the new expiry: a JWT's
 * lifetime is signed into it, so re-writing the old string would slide the
 * cookie without sliding the session and sign the user out anyway.
 */
export async function touchClientSession(
  sessionId: string,
  remember: boolean,
): Promise<{ token: string; expiresAt: Date } | null> {
  const expiresAt = clientSessionExpiry(remember);
  const next = await patch('client', sessionId, {
    lastSeenAt: Date.now(),
    expiresAt: expiresAt.getTime(),
  });
  if (!next) return null;

  return { token: issue(sessionId, next), expiresAt };
}

export async function revokeClientSession(sessionId: string): Promise<void> {
  await destroy('client', sessionId);
}

/** Used after a password change: every other device is signed out. */
export async function revokeAllClientSessions(
  clientAccountId: string,
  exceptSessionId?: string,
): Promise<void> {
  await revokeAll('client', clientAccountId, exceptSessionId);
}

export async function listClientSessions(clientAccountId: string): Promise<LoadedSession[]> {
  return listSessions('client', clientAccountId);
}

// ------------------------------------------------------------------- admin ---

export async function createAdminSession(
  request: Attribution,
  adminId: string,
  options: { otpVerified: boolean; otpCodeHash?: string; otpExpiresAt?: Date },
): Promise<CreatedSession> {
  const expiresAt = addMinutes(
    new Date(),
    options.otpVerified ? config.security.adminSessionTtlMinutes : config.security.otpChallengeTtlMinutes,
  );

  return create(request, options.otpVerified ? 'admin' : 'adminOtp', adminId, expiresAt, {
    otpCodeHash: options.otpCodeHash ?? null,
    otpExpiresAt: options.otpExpiresAt?.getTime() ?? null,
    otpSentAt: options.otpCodeHash ? Date.now() : null,
  });
}

/** Issues a fresh passcode against an existing challenge (the resend path). */
export async function replaceSessionOtp(
  sessionId: string,
  codeHash: string,
  expiresAt: Date,
): Promise<void> {
  await patch('admin', sessionId, {
    otpCodeHash: codeHash,
    otpExpiresAt: expiresAt.getTime(),
    otpSentAt: Date.now(),
    otpAttempts: 0,
  });
}

/** Records a failed guess and reports the running total. */
export async function registerOtpAttempt(sessionId: string): Promise<number> {
  const record = await readRecord('admin', sessionId);
  if (!record) return 0;

  const attempts = record.otpAttempts + 1;
  await writeRecord(sessionId, { ...record, otpAttempts: attempts });
  return attempts;
}

export async function promoteAdminSession(sessionId: string): Promise<CreatedSession | null> {
  const record = await readRecord('admin', sessionId);
  if (!record) return null;

  const jti = randomUUID();
  const now = Date.now();
  const next: SessionRecord = {
    ...record,
    audience: 'admin',
    verified: true,
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: addMinutes(new Date(), config.security.adminSessionTtlMinutes).getTime(),
    otpCodeHash: null,
    otpExpiresAt: null,
    otpSentAt: null,
    otpAttempts: 0,
  };

  await writeRecord(jti, next);
  await destroy('admin', sessionId);

  return { id: jti, token: issue(jti, next), expiresAt: new Date(next.expiresAt) };
}

/**
 * The single writer of `authenticatedAt` for an already-verified session — this
 * is what makes `REAUTH_REQUIRED` recoverable.
 */
export async function refreshAdminSessionAuth(sessionId: string): Promise<void> {
  const now = Date.now();
  await patch('admin', sessionId, {
    authenticatedAt: now,
    lastSeenAt: now,
    expiresAt: addMinutes(new Date(), config.security.adminSessionTtlMinutes).getTime(),
  });
}

/** Login hygiene: drop challenges that were started and never completed. */
export async function revokeUnverifiedAdminSessions(adminId: string): Promise<void> {
  await revokeUnverified('admin', adminId);
}

export async function findAdminSession(token: string): Promise<LoadedSession | null> {
  return resolve(token, ['admin', 'adminOtp']);
}

/** Loads a session by id, for the OTP step which already knows which one it is. */
export async function findAdminSessionById(sessionId: string): Promise<LoadedSession | null> {
  return loadById('admin', sessionId);
}

export async function touchAdminSession(
  sessionId: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const expiresAt = addMinutes(new Date(), config.security.adminSessionTtlMinutes);
  const next = await patch('admin', sessionId, {
    lastSeenAt: Date.now(),
    expiresAt: expiresAt.getTime(),
  });
  if (!next) return null;

  return { token: issue(sessionId, next), expiresAt };
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await destroy('admin', sessionId);
}

export async function revokeAllAdminSessions(adminId: string, exceptSessionId?: string): Promise<void> {
  await revokeAll('admin', adminId, exceptSessionId);
}

export async function listAdminSessions(adminId: string): Promise<LoadedSession[]> {
  return listSessions('admin', adminId);
}

// ----------------------------------------------------------------- cookies ---

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
 * and never through the session helpers above. It is deliberately not a JWT: it
 * carries no claims, authenticates nothing on its own, and is only consulted
 * *after* a password has already verified.
 */
export function setDeviceCookie(
  reply: FastifyReply,
  audience: DeviceAudience,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION_COOKIE[audience], token, { ...COOKIE_BASE, expires: expiresAt });
}

export function clearDeviceCookie(reply: FastifyReply, audience: DeviceAudience): void {
  reply.clearCookie(SESSION_COOKIE[audience], COOKIE_BASE);
}

export function readDeviceToken(request: FastifyRequest, audience: DeviceAudience): string | null {
  const raw = request.cookies?.[SESSION_COOKIE[audience]];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

// ------------------------------------------------------------ housekeeping ---

/**
 * Records expire on their own — Redis holds each for exactly as long as its
 * token is valid. What outlives them is the per-user index, which keeps naming
 * sessions that are already gone, so this walks the index keys and drops the
 * dead members.
 *
 * `SCAN` rather than `KEYS`: this Redis is shared with the client platform and
 * with BullMQ, and blocking it to tidy a set nobody is waiting on would be a
 * poor trade.
 */
export async function purgeExpiredSessions(): Promise<number> {
  let cursor = '0';
  let pruned = 0;

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'session-index:*', 'COUNT', 200);
    cursor = next;

    for (const key of keys) {
      const ids = await redis.smembers(key);
      if (ids.length === 0) continue;

      const family = key.split(':')[1] as Family;
      const raws = await redis.mget(ids.map((jti) => recordKey(family, jti)));
      const dead = ids.filter((_, position) => !raws[position]);

      if (dead.length > 0) {
        await redis.srem(key, ...dead);
        pruned += dead.length;
      }
    }
  } while (cursor !== '0');

  return pruned;
}
