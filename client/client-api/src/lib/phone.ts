import { config } from '../config/index';

/**
 * Turning what somebody typed into the one shape a phone identity is stored in.
 *
 * A phone number is only usable as a login if two people holding the same
 * handset always produce the same string. Shoppers do not: `01712345678`,
 * `+8801712345678`, `8801712345678`, `017-1234-5678` and `+880 1712 345678` are
 * one number typed five ways, and stored as five rows they would be five
 * customers — each able to register while the others already exist, none able to
 * see the orders of the rest.
 *
 * So normalisation happens **before** anything is looked up or written, and
 * E.164 is what comes out of it: a leading `+`, a country code, no spaces, no
 * punctuation, no trunk zero.
 *
 * Deliberately not libphonenumber. That library carries per-country metadata to
 * answer a question this platform does not ask — whether a number is actually
 * assignable in its country — while a shop only needs two spellings of one
 * number to match and a code to reach the handset. Take the dependency the day
 * the platform starts caring which operator or which region a number belongs to.
 */

/** E.164 allows at most fifteen digits after the `+`, and no reachable number is under eight. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * A trunk `0` is a *domestic* prefix — it means "I am dialling inside my own
 * country" and is not part of the number itself. Bangladesh, India, Pakistan
 * and the UK all use one, so it goes whenever a national number is promoted to
 * an international one. Leaving it on is the single most common reason two
 * spellings of the same number fail to match.
 */
function stripTrunkZero(digits: string): string {
  return digits.replace(/^0+/, '');
}

/**
 * The typed number in E.164, or null when it cannot be one.
 *
 * Null rather than a throw: every caller renders the refusal as a field error,
 * and an exception is the wrong shape for "the customer mistyped".
 */
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Everything that is not a digit is punctuation somebody added for
  // legibility — spaces, dashes, brackets, a dot.
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return null;

  const cc = config.sms.defaultCountryCode.replace(/[^0-9]/g, '');

  const value = trimmed.startsWith('+')
    ? digits
    : /*
       * `00` is the international access code across most of the world and means
       * exactly what `+` means. Reading it as two digits of a country code would
       * put `008801712345678` in country `00`, which does not exist.
       */
      trimmed.startsWith('00')
      ? digits.slice(2)
      : digits.startsWith('0')
        ? `${cc}${stripTrunkZero(digits)}`
        : /*
           * No plus, no trunk zero: either the shopper wrote the country code and
           * left the plus off, or they wrote a bare national number. For the
           * countries this platform serves the two cannot collide — a Bangladeshi
           * national number begins with 1 once its trunk zero is gone, so a string
           * beginning 880 is never one of them. Where that stops being true, the
           * shopper's own dialling habit is still a better guess than silently
           * moving them to another country.
           */
          digits.startsWith(cc)
          ? digits
          : `${cc}${digits}`;

  if (value.length < MIN_DIGITS || value.length > MAX_DIGITS) return null;

  return `+${value}`;
}

/**
 * The tail of a number, for telling somebody which handset a code went to
 * without printing it for whoever is looking over their shoulder — and without
 * confirming to a stranger what the number on an account is.
 */
export function maskPhone(e164: string): string {
  return `••• ${e164.slice(-3)}`;
}
