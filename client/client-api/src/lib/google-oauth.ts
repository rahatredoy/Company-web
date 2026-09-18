import { config } from '../config/index';
import { AppError, ERROR_CODES } from './errors';

/**
 * Sign in with Google, as far as Google itself is concerned.
 *
 * Everything tenant-shaped lives elsewhere. This file knows two endpoints, one
 * client credential and how to read what comes back.
 *
 * **One redirect URI serves the whole platform.** Google matches redirect URIs
 * by exact string and supports no wildcard of any kind, so a per-store URI would
 * mean editing a Google Cloud project every time somebody opened a shop — and
 * would make a custom domain impossible to support at all. The URI registered is
 * `{API_PUBLIC_URL}/api/v1/oauth/google/callback`, which is this API's own
 * address and therefore fixed; which store a particular sign-in belongs to is
 * carried in the `state` parameter instead. See `lib/oauth-state.ts`.
 */

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Google has issued tokens under both spellings for years; both are legitimate. */
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export interface GoogleProfile {
  /**
   * Google's own immutable id for this person, and the only thing an account is
   * matched on. The address is not: a Workspace administrator can change a
   * user's, and a released Gmail address can in principle be reissued — either
   * of which, matched on, would hand one person another person's order history.
   */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
  pictureUrl: string | null;
}

export function googleEnabled(): boolean {
  return config.oauth.google !== null;
}

/** The single URI registered with Google, built from this API's own address. */
export function googleRedirectUri(): string {
  return `${config.api.publicUrl.replace(/\/$/, '')}/api/v1/oauth/google/callback`;
}

function credentials(): { clientId: string; clientSecret: string } {
  const google = config.oauth.google;
  if (!google) {
    throw new AppError(
      ERROR_CODES.FEATURE_NOT_IN_PLAN,
      'Signing in with Google is not available on this store.',
      503,
    );
  }
  return google;
}

/**
 * Where the browser is sent to sign in.
 *
 * `openid email profile` and nothing else — a shop needs a stable id, an address
 * to reach the customer at and a name to put on the order. Every additional
 * scope is a consent screen the shopper reads more carefully and a permission
 * this platform would then hold without using.
 *
 * `prompt=select_account` because a shared or family device is the normal case
 * in this market: without it Google silently reuses whichever account is already
 * signed in, and the shopper ends up in somebody else's shop account without
 * ever being shown a choice.
 */
export function googleAuthorizeUrl(state: string): string {
  const { clientId } = credentials();

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', googleRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  // No refresh token is wanted: this is a sign-in, not an ongoing grant to read
  // anything of the customer's, and a token nobody uses is only a token to leak.
  url.searchParams.set('access_type', 'online');

  return url.toString();
}

/**
 * Trades the one-time code for the profile behind it.
 *
 * **The `id_token` signature is deliberately not verified**, and that is
 * permitted rather than skipped: OpenID Connect Core §3.1.3.7 says a token
 * received by direct communication between the client and the token endpoint may
 * be validated by TLS server authentication instead. This request goes to
 * Google's own token endpoint over HTTPS and is authenticated with the client
 * secret, so a response reaching this line came from Google or from nobody.
 * Fetching and caching a JWKS to re-check a signature on a document we were
 * handed over an authenticated channel would add a network dependency to every
 * sign-in and a key-rotation failure mode, and would prove nothing further.
 *
 * The claims that carry meaning are still checked, because they say what the
 * token is *for*: an `aud` that is not this client is a token minted for a
 * different application, which is the one attack this step must refuse.
 */
export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const { clientId, clientSecret } = credentials();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new AppError(
      ERROR_CODES.INVALID_TOKEN,
      'Google could not confirm that sign-in. Please try again.',
      401,
    );
  }

  const body = (await response.json().catch(() => null)) as { id_token?: string } | null;
  if (!body?.id_token) {
    throw new AppError(
      ERROR_CODES.INVALID_TOKEN,
      'Google did not return a sign-in token.',
      502,
    );
  }

  return readIdToken(body.id_token, clientId);
}

interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

function readIdToken(idToken: string, clientId: string): GoogleProfile {
  const claims = decodeClaims(idToken);

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];

  const invalid = () =>
    new AppError(ERROR_CODES.INVALID_TOKEN, 'That Google sign-in could not be accepted.', 401);

  if (!claims.iss || !ISSUERS.has(claims.iss)) throw invalid();
  if (!audiences.includes(clientId)) throw invalid();
  if (!claims.sub) throw invalid();
  // Seconds, and Google's clock rather than ours; an expired token means the
  // exchange took minutes, which is a retry rather than an error worth naming.
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) throw invalid();

  return {
    subject: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null,
    /*
     * Google sends this as a boolean, and historically as the *string* "true".
     * Reading it loosely would be a mistake in the other direction — everything
     * downstream that links a Google sign-in to an existing password account
     * hangs on this flag, so anything that is not exactly true is false.
     */
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    fullName: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
    pictureUrl: typeof claims.picture === 'string' ? claims.picture : null,
  };
}

function decodeClaims(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1];
  if (!payload) {
    throw new AppError(ERROR_CODES.INVALID_TOKEN, 'That Google sign-in could not be read.', 401);
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    throw new AppError(ERROR_CODES.INVALID_TOKEN, 'That Google sign-in could not be read.', 401);
  }
}
