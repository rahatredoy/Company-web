import { randomInt } from 'node:crypto';
import { safeEqual, sha256 } from './crypto';

/**
 * One-time passcodes.
 *
 * A deliberate copy of `company-api/src/lib/otp.ts`, under the same rule the
 * sanitiser and the URL validators are copied under: the two platforms deploy
 * independently, and a shared package would mean an upgrade on one side could
 * change how the other side's sign-in behaves.
 *
 * What it is used for differs. On the company side a code is a *second* step
 * after a password. Here it is the *only* step — a phone number and the code
 * sent to it are the whole credential — so the attempt cap and the short expiry
 * below are not belt-and-braces, they are the security of the flow.
 */

/** Six digits: a million combinations, and short enough to retype from a lock screen. */
export const OTP_LENGTH = 6;

/**
 * Wrong guesses one challenge tolerates before it is burned.
 *
 * A million combinations is only a million if guessing stops. Five ends the
 * challenge outright rather than locking the account, so the cost of somebody
 * else guessing at your number is that you request a new code.
 */
export const OTP_MAX_ATTEMPTS = 5;

/** How long a code stays good for. Long enough for a slow network, short enough to matter. */
export const OTP_TTL_MINUTES = 10;

/** A resend inside this window is refused, so nobody's handset can be used as a doorbell. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * `randomInt` is the CSPRNG, not `Math.random` — a predictable passcode is not a
 * passcode. Leading zeros are kept, so every code is exactly six digits.
 */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/** Hashed before it is stored: a read of the store hands over no working code. */
export function hashOtp(code: string): string {
  return sha256(code.trim());
}

/** Constant-time, so response timing cannot leak a partial match. */
export function verifyOtp(storedHash: string | null | undefined, submitted: string): boolean {
  if (!storedHash) return false;
  return safeEqual(storedHash, hashOtp(submitted));
}

/** Shown as `123 456`, which is markedly easier to read off a lock screen. */
export function formatOtpForDisplay(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Seconds a caller must still wait before another code may be sent. */
export function resendWaitSeconds(lastSentAt: number | null | undefined): number {
  if (!lastSentAt) return 0;
  const elapsed = (Date.now() - lastSentAt) / 1000;
  return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}
