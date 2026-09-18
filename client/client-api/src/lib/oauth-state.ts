import { tenantKey } from './cache';
import { generateToken, sha256 } from './crypto';
import type { GoogleProfile } from './google-oauth';
import { redis } from './redis';

/**
 * The two short-lived records that carry a Google sign-in across the seam
 * between one platform-wide callback and one particular store.
 *
 * The seam exists because Google matches redirect URIs exactly and has no
 * wildcards, so the callback lands on **this API's own address** and not on the
 * shop the shopper was standing in. Two hand-offs bridge that:
 *
 * 1. **State**, written when the browser is sent to Google and spent when it
 *    comes back. It names the store and where to return to, so the callback can
 *    find its way home without reading anything the browser could have written.
 *    Not tenant-scoped — the callback has no tenant until it reads this.
 * 2. **A hand-off code**, written by the callback and spent by the storefront.
 *    It is what lets the session cookie be set on the shop's own origin rather
 *    than on the API's, and it is tenant-scoped, so a code minted for one store
 *    cannot be presented to another.
 *
 * Both are opaque, single-use, short, and stored under `sha256` of themselves —
 * a read of Redis hands over nothing that can be replayed.
 */

/** Long enough for a slow consent screen, short enough that a leaked link is dead. */
const STATE_TTL_SECONDS = 10 * 60;

/** Only a redirect and one server call, so this can be very short indeed. */
const HANDOFF_TTL_SECONDS = 2 * 60;

export interface OAuthState {
  tenantRef: string;
  slug: string;
  /**
   * Where the browser is sent after the callback.
   *
   * Derived by the API from the store's own canonical address, **never** from
   * anything the browser supplied. A callback that redirected to an origin off
   * the query string would be an open redirect wearing a sign-in's clothes.
   */
  returnOrigin: string;
  /** A path within the storefront, already validated by whoever wrote the state. */
  next: string;
}

function stateKey(token: string): string {
  return `oauth:google:state:${sha256(token)}`;
}

function handoffKey(tenantRef: string, code: string): string {
  return tenantKey(tenantRef, 'oauth', 'google', sha256(code));
}

export async function saveOAuthState(state: OAuthState): Promise<string> {
  const token = generateToken(32);
  await redis.set(stateKey(token), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
  return token;
}

/**
 * Spends a state token.
 *
 * `MULTI` so read and delete are one operation: the token doubles as the CSRF
 * defence for the whole flow, and a token that can be replayed is not one.
 */
export async function consumeOAuthState(token: string): Promise<OAuthState | null> {
  const key = stateKey(token);
  const result = await redis.multi().get(key).del(key).exec();
  const value = result?.[0]?.[1];
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value) as OAuthState;
  } catch {
    return null;
  }
}

export async function issueGoogleHandoff(
  tenantRef: string,
  profile: GoogleProfile,
): Promise<string> {
  const code = generateToken(32);
  await redis.set(
    handoffKey(tenantRef, code),
    JSON.stringify(profile),
    'EX',
    HANDOFF_TTL_SECONDS,
  );
  return code;
}

export async function consumeGoogleHandoff(
  tenantRef: string,
  code: string,
): Promise<GoogleProfile | null> {
  const key = handoffKey(tenantRef, code);
  const result = await redis.multi().get(key).del(key).exec();
  const value = result?.[0]?.[1];
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value) as GoogleProfile;
  } catch {
    return null;
  }
}
