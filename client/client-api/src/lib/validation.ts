import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address.');

/**
 * Length carries most of the strength, so the floor is 10 rather than the usual
 * 8, and character-class rules are kept light — long passphrases must not be
 * rejected for lacking a symbol.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')
  .refine((v) => /[a-z]/.test(v), 'Include a lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include an uppercase letter.')
  .refine((v) => /[0-9]/.test(v), 'Include a number.');

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.');

export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Enter a recovery code in the format XXXX-XXXX-XXXX.');

export const opaqueTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,128}$/, 'That link is not valid.');

export const nameSchema = z.string().trim().min(1, 'Enter a name.').max(120);

export const phoneSchema = z
  .string()
  .trim()
  .max(24)
  .regex(/^[0-9+()\-\s]*$/, 'Enter a valid phone number.')
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/** URL-safe, lowercase, no leading/trailing or doubled hyphens. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and single hyphens.')
  .refine((v) => !v.includes('--'), 'Use single hyphens only.');

/** Money arrives as a string so it never round-trips through a float. */
export const moneySchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.trim()))
  .refine((v) => /^-?\d{1,10}(\.\d{1,2})?$/.test(v), 'Enter an amount like 19.99.');

export const positiveMoneySchema = moneySchema.refine(
  (v) => Number.parseFloat(v) >= 0,
  'Amount cannot be negative.',
);

export const quantitySchema = z.coerce.number().int().min(0).max(1_000_000);
