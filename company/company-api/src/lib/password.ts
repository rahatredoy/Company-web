import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
 * The library's `Algorithm` export is an ambient const enum, which cannot be
 * referenced under isolatedModules — 2 is Argon2id, and it is also the default.
 */
const ARGON2ID = 2;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong password", never as an error.
    return false;
  }
}

/**
 * Burns roughly the same time as a real verification so a missing account and a
 * wrong password are indistinguishable from the outside.
 */
export async function fakeVerify(): Promise<void> {
  await hashPassword('not-a-real-password-timing-equaliser').catch(() => undefined);
}
