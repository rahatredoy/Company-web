import { tenantKey } from '../../lib/cache';
import { generateToken, sha256 } from '../../lib/crypto';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES, hashOtp, verifyOtp } from '../../lib/otp';
import { redis } from '../../lib/redis';

/**
 * The live half of phone sign-in: an outstanding code, and the short-lived
 * ticket a passed code turns into.
 *
 * **In Redis rather than in the tenant database**, for the reason sessions are:
 * these records are ephemeral by construction — ten minutes, then meaningless —
 * and a table of them is a table that needs sweeping, that shows up in backups,
 * and that hands whoever reads a dump the outstanding codes of everyone signing
 * in at that moment. The keys are tenant-scoped, so a code sent by one store can
 * never be presented to another.
 *
 * The number itself is not a key: `sha256(e164)` is. A Redis instance shared by
 * every store on the platform would otherwise hold a plaintext list of the phone
 * numbers currently signing in to each of them.
 */

const TICKET_TTL_SECONDS = 10 * 60;

interface Challenge {
  hash: string;
  /** Epoch milliseconds, so the resend cooldown can be answered without a second key. */
  sentAt: number;
  attempts: number;
}

function challengeKey(tenantRef: string, e164: string): string {
  return tenantKey(tenantRef, 'phone-otp', sha256(e164));
}

function ticketKey(tenantRef: string, token: string): string {
  return tenantKey(tenantRef, 'phone-ticket', sha256(token));
}

/** The outstanding challenge for a number, or null. Read to answer "wait how long?". */
export async function readChallenge(tenantRef: string, e164: string): Promise<Challenge | null> {
  const row = await redis.hgetall(challengeKey(tenantRef, e164));
  if (!row || !row.hash) return null;

  return {
    hash: row.hash,
    sentAt: Number(row.sentAt ?? 0),
    attempts: Number(row.attempts ?? 0),
  };
}

/**
 * Replaces whatever was outstanding for this number.
 *
 * Replaces rather than adds: one number has at most one live code, so a resend
 * invalidates the previous message. Two codes valid at once would double the
 * guessing surface and would leave a shopper reading whichever text arrived
 * second while the first still worked.
 */
export async function storeChallenge(tenantRef: string, e164: string, code: string): Promise<void> {
  const key = challengeKey(tenantRef, e164);
  await redis
    .multi()
    .del(key)
    .hset(key, { hash: hashOtp(code), sentAt: String(Date.now()), attempts: '0' })
    .expire(key, OTP_TTL_MINUTES * 60)
    .exec();
}

export type ChallengeOutcome = 'ok' | 'wrong' | 'expired' | 'exhausted';

/**
 * Checks a submitted code and, on a match, burns the challenge.
 *
 * A wrong guess increments the counter and the challenge dies at
 * `OTP_MAX_ATTEMPTS` — six digits is a million combinations only for as long as
 * guessing stops. Ending the *challenge* rather than locking the *account* is
 * deliberate: the number is public, so anyone could otherwise lock a stranger
 * out of their own shop account by guessing at it.
 */
export async function consumeChallenge(
  tenantRef: string,
  e164: string,
  code: string,
): Promise<ChallengeOutcome> {
  const key = challengeKey(tenantRef, e164);
  const challenge = await readChallenge(tenantRef, e164);

  // No record means the ten minutes are up, or it was already spent. Both are
  // "ask for a new one", and telling them apart would say whether the number is
  // in the middle of signing in.
  if (!challenge) return 'expired';

  if (!verifyOtp(challenge.hash, code)) {
    const attempts = await redis.hincrby(key, 'attempts', 1);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await redis.del(key);
      return 'exhausted';
    }
    return 'wrong';
  }

  await redis.del(key);
  return 'ok';
}

/**
 * Proof that a number was verified, handed back so the shopper can be asked
 * their name before an account is made for them.
 *
 * The alternative was to ask for the name up front, which would mean the form
 * knows whether the number already has an account before anything is proved —
 * and a form that renders "your name" for a stranger's number and "welcome
 * back" for their neighbour's is an account-existence oracle that anybody can
 * walk. So the code comes first, always, and the name is only ever asked for
 * after it has been passed.
 */
export async function issueTicket(tenantRef: string, e164: string): Promise<string> {
  const token = generateToken(32);
  await redis.set(ticketKey(tenantRef, token), e164, 'EX', TICKET_TTL_SECONDS);
  return token;
}

/**
 * Spends a ticket and returns the number it stood for.
 *
 * `MULTI` so the read and the delete are one operation: two submissions of the
 * same ticket arriving together must not both be able to create an account.
 */
export async function consumeTicket(tenantRef: string, token: string): Promise<string | null> {
  const key = ticketKey(tenantRef, token);
  const result = await redis.multi().get(key).del(key).exec();
  const value = result?.[0]?.[1];
  return typeof value === 'string' ? value : null;
}
