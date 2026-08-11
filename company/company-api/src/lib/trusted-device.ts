import { redis } from './redis';
import { config } from '../config/index';
import { generateToken, sha256 } from './crypto';
import { logger } from './logger';

/**
 * Remembered browsers for the company admin sign-in.
 *
 * The passcode exists so that a stolen password is not by itself a way in. It
 * does not have to be re-proven on a machine that already proved it: once a
 * browser clears the code, it is issued an opaque device token, and inside the
 * trust window the *correct password plus that token* completes sign-in with no
 * new code. Every other browser still gets one.
 *
 * The token is a second secret, never a credential: on its own it reaches
 * nothing, because `/login` only consults it after the password has verified.
 * Only its SHA-256 is stored, so reading the store hands an attacker nothing
 * replayable — the same rule the session tokens follow.
 *
 * Redis is the store rather than a table: the record is short-lived, expires by
 * itself, and losing it on a flush costs one extra passcode, not access.
 */

/** `admin-device:<sha256>` → admin id. The hash is the key, so a lookup is O(1). */
function key(token: string): string {
  return `admin-device:${sha256(token)}`;
}

/** Membership index, so a password change can drop every remembered browser at once. */
function indexKey(adminId: string): string {
  return `admin-devices:${adminId}`;
}

export function trustedDeviceTtlSeconds(): number {
  return config.security.adminTrustedDeviceDays * 24 * 60 * 60;
}

export function trustedDeviceEnabled(): boolean {
  return trustedDeviceTtlSeconds() > 0;
}

export function trustedDeviceExpiry(): Date {
  return new Date(Date.now() + trustedDeviceTtlSeconds() * 1000);
}

/**
 * Issues a token for this browser and remembers it for the trust window.
 * Returns `null` when the feature is off, which is the caller's signal to set
 * no cookie at all.
 */
export async function rememberDevice(adminId: string): Promise<string | null> {
  if (!trustedDeviceEnabled()) return null;

  const token = generateToken(32);
  const ttl = trustedDeviceTtlSeconds();

  try {
    await redis
      .multi()
      .set(key(token), adminId, 'EX', ttl)
      .sadd(indexKey(adminId), sha256(token))
      // The index outlives its members so a stale entry is only ever a no-op
      // delete, never a device that keeps working past its own expiry.
      .expire(indexKey(adminId), ttl + 86_400)
      .exec();
  } catch (error) {
    // Failing to remember a browser is a convenience lost, not a sign-in lost.
    logger.error({ err: (error as Error).message }, 'could not remember trusted device');
    return null;
  }

  return token;
}

/**
 * True when this token was issued to this admin and has not expired.
 *
 * Fails **closed** — a Redis outage sends the caller down the passcode path,
 * the opposite of the rate limiter, because here failing open would skip a
 * factor rather than inconvenience a user.
 */
export async function isDeviceTrusted(adminId: string, token: string | null): Promise<boolean> {
  if (!trustedDeviceEnabled() || !token) return false;

  try {
    return (await redis.get(key(token))) === adminId;
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'trusted device lookup failed');
    return false;
  }
}

/** Slides the window forward, so a browser in daily use is never asked again. */
export async function refreshDevice(token: string): Promise<void> {
  if (!trustedDeviceEnabled()) return;
  await redis.expire(key(token), trustedDeviceTtlSeconds()).catch(() => undefined);
}

/** Forgets one browser — used when that browser signs out for good. */
export async function forgetDevice(adminId: string, token: string | null): Promise<void> {
  if (!token) return;
  await redis
    .multi()
    .del(key(token))
    .srem(indexKey(adminId), sha256(token))
    .exec()
    .catch(() => undefined);
}

/**
 * Forgets every remembered browser. A password change already signs the other
 * devices out; leaving them trusted would let the *old* password's device skip
 * the code on its way back in with the new one.
 */
export async function forgetAllDevices(adminId: string): Promise<void> {
  try {
    const hashes = await redis.smembers(indexKey(adminId));
    const pipeline = redis.multi();
    for (const hash of hashes) pipeline.del(`admin-device:${hash}`);
    pipeline.del(indexKey(adminId));
    await pipeline.exec();
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'could not clear trusted devices');
  }
}
