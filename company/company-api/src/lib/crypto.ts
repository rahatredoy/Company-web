import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config/index';

const KEY = Buffer.from(config.security.encryptionKey, 'base64url').subarray(0, 32);

/** URL-safe opaque token. Only the SHA-256 of this is ever persisted. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

/** Length-safe constant-time comparison for secrets and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Still burn a comparison so the timing does not reveal the length.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * AES-256-GCM. Used for the admin's TOTP seed, which must be recoverable
 * (unlike passwords, which are hashed).
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted payload.');
  }
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

const ID_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

/** Short public identifier, e.g. TNT-7F3K9QX2 or TKT-4B2M9ZQ1. */
export function publicId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return `${prefix}-${out}`;
}

/** Recovery codes are shown once, then stored only as hashes. */
export function generateRecoveryCode(): string {
  const raw = randomBytes(9);
  let out = '';
  for (let i = 0; i < 12; i += 1) out += ID_ALPHABET[raw[i % raw.length]! % ID_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export { randomUUID };
