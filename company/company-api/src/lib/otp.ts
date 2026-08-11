import { randomInt } from 'node:crypto';
import { sha256, safeEqual } from './crypto';

/**
 * Email one-time passcodes for the second step of sign-in.
 *
 * The code is generated here, **hashed** before it touches the database, and
 * compared in constant time. Storing it in plaintext would mean a read of the
 * sessions table hands an attacker a working second factor for every login in
 * flight.
 */

/** Six digits — long enough given the attempt cap and short expiry, short enough to retype. */
export const OTP_LENGTH = 6;

/**
 * How many wrong guesses a single challenge tolerates before it is burned.
 *
 * Six digits is a million combinations, but a challenge that accepted unlimited
 * guesses for five minutes would still be brute-forceable. Five ends it.
 */
export const OTP_MAX_ATTEMPTS = 5;

/** A resend inside this window is refused, so the endpoint cannot be used to spam an inbox. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * `randomInt` is the CSPRNG, not `Math.random` — a predictable passcode is not
 * a passcode. Leading zeros are preserved, so every code is exactly six digits.
 */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export function hashOtp(code: string): string {
  return sha256(code);
}

/** Constant-time comparison, so response timing cannot leak a partial match. */
export function verifyOtp(storedHash: string | null | undefined, submitted: string): boolean {
  if (!storedHash) return false;
  return safeEqual(storedHash, sha256(submitted.trim()));
}

export function otpExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function isOtpExpired(expiresAt: Date | null | undefined): boolean {
  return !expiresAt || expiresAt.getTime() <= Date.now();
}

/** Seconds a caller must still wait before another code may be sent. */
export function resendWaitSeconds(lastSentAt: Date | null | undefined): number {
  if (!lastSentAt) return 0;
  const elapsed = (Date.now() - lastSentAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}

/** Shown in the email as `123 456`, which is markedly easier to read back. */
export function formatOtpForDisplay(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
