import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HS256 JSON Web Tokens, hand-rolled over `node:crypto`.
 *
 * A deliberate copy of `company-api/src/lib/jwt.ts`, under the same rule the
 * sanitiser and the slug helpers follow: the two platforms are deployed
 * independently, and a shared package would mean an upgrade on one side could
 * change how the other side verifies a session. Neither copy verifies the
 * other's tokens — different secrets, different audiences — so they are only
 * ever the same code, never the same trust boundary. Change one, decide
 * explicitly about the other.
 *
 * No dependency, for the same reason `lib/storage.ts` signs SigV4 by hand and
 * `lib/otp.ts` derives TOTP by hand: a JWT is a dot-joined base64url triple over
 * one HMAC, and pulling in a library to compute it would be the largest thing in
 * an API that has seventeen dependencies.
 *
 * Three properties this holds, and they are the ones JWT implementations
 * usually get wrong:
 *
 * 1. **The algorithm is not negotiable.** The header is read, but `alg` is only
 *    ever compared against the one value this file supports. A token presenting
 *    `{"alg":"none"}` — or `HS256` swapped for an asymmetric name so the public
 *    key is used as the HMAC secret — is refused before its signature is looked
 *    at. Trusting the header's `alg` is the classic JWT forgery.
 * 2. **The signature is compared in constant time**, over the exact bytes that
 *    were signed rather than a re-serialisation of the decoded claims. JSON key
 *    order is not stable, so re-encoding and comparing strings would reject
 *    valid tokens and, worse, invite a "compare the claims instead" fix.
 * 3. **`aud` is mandatory and exact.** It is what stops a company-client token
 *    authenticating as a company-admin, or a store-admin token being replayed
 *    against a storefront customer route. Every caller names the audience it
 *    will accept; a token minted for any other is not a token here.
 *
 * Nothing throws. Every failure — malformed, wrong algorithm, bad signature,
 * expired, wrong audience — returns `null`, so a guard cannot accidentally
 * distinguish them and leak which part was wrong.
 */

const ALGORITHM = 'HS256';
const TYPE = 'JWT';

/** Encoded once: the header is identical for every token this file issues. */
const ENCODED_HEADER = encode(JSON.stringify({ alg: ALGORITHM, typ: TYPE }));

/**
 * Tolerance for clock drift between the API instances that sign and verify.
 * Deliberately small — it widens the life of every token by this much.
 */
const CLOCK_SKEW_SECONDS = 30;

/** The registered claims this file manages; everything else rides alongside. */
export interface JwtClaims {
  /** Subject — the account, admin or customer id. */
  sub: string;
  /** Audience — see property 3 above. */
  aud: string;
  /** Token id. Names the Redis record that can revoke this token. */
  jti: string;
  iss: string;
  iat: number;
  exp: number;
  [claim: string]: unknown;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value as string, typeof value === 'string' ? 'utf8' : undefined).toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(signingInput: string, secret: string): string {
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest('base64url');
}

export interface SignOptions {
  secret: string;
  issuer: string;
  audience: string;
  subject: string;
  jwtId: string;
  expiresAt: Date;
  /** Audience-specific claims — verification state, tenant, remember, and such. */
  claims?: Record<string, unknown>;
}

export function signJwt(options: SignOptions): string {
  const issuedAt = Math.floor(Date.now() / 1000);

  const payload: JwtClaims = {
    ...options.claims,
    sub: options.subject,
    aud: options.audience,
    jti: options.jwtId,
    iss: options.issuer,
    iat: issuedAt,
    exp: Math.floor(options.expiresAt.getTime() / 1000),
  };

  const signingInput = `${ENCODED_HEADER}.${encode(JSON.stringify(payload))}`;
  return `${signingInput}.${signature(signingInput, options.secret)}`;
}

export interface VerifyOptions {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * Returns the claims of a token that is well-formed, correctly signed, unexpired
 * and addressed to `audience` — and `null` for every other token.
 *
 * This performs no I/O. Whether the session behind a valid token is still live
 * is a separate question, answered by the Redis record `jti` names; see
 * `lib/session.ts`.
 */
export function verifyJwt(token: string, options: VerifyOptions): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, provided] = parts as [string, string, string];
  if (!encodedHeader || !encodedPayload || !provided) return null;

  let header: { alg?: unknown; typ?: unknown };
  let claims: JwtClaims;
  try {
    header = JSON.parse(decode(encodedHeader)) as { alg?: unknown; typ?: unknown };
    claims = JSON.parse(decode(encodedPayload)) as JwtClaims;
  } catch {
    return null;
  }

  // Checked before the signature: the header must not be able to choose how the
  // signature is verified.
  if (header.alg !== ALGORITHM) return null;
  if (header.typ !== undefined && header.typ !== TYPE) return null;

  const expected = signature(`${encodedHeader}.${encodedPayload}`, options.secret);
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  if (expectedBytes.length !== providedBytes.length) return null;
  if (!timingSafeEqual(expectedBytes, providedBytes)) return null;

  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.jti !== 'string' || !claims.jti) return null;
  if (claims.iss !== options.issuer) return null;
  if (claims.aud !== options.audience) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS <= now) return null;
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now) return null;

  return claims;
}

/**
 * The claims of a token whose signature has already been checked — used only to
 * clear a cookie the API has just refused, where the id is wanted but no trust
 * is placed in it. Never call this to authenticate anything.
 */
export function decodeExpiredJwt(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(decode(parts[1])) as JwtClaims;
  } catch {
    return null;
  }
}
