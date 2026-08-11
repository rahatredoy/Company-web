import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walk up from this file until a `.env` is found (container deploys inject real env vars instead). */
function loadEnvFile(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv({ quiet: true });
}

loadEnvFile();

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const port = z.coerce.number().int().min(1).max(65535);

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/** Blank is treated as unset; anything else has to be a real address. */
const optionalEmail = optionalString.refine(
  (v) => v === undefined || z.string().email().safeParse(v).success,
  'must be a valid email address',
);

/** Must decode to at least 32 bytes — these key HMACs and AES-256-GCM. */
const secretKey = z
  .string()
  .min(32, 'must be at least 32 characters')
  .refine((v) => Buffer.from(v, 'base64url').length >= 32, 'must decode to at least 32 bytes (base64url)');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  COMPANY_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  API_PORT: port.default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  WEBSITE_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:3001'),

  PLATFORM_ROOT_DOMAIN: z.string().default('company.com'),
  CLIENT_ADMIN_URL_PATTERN: z.string().default('https://admin.{slug}.company.com'),
  DNS_TARGET: z.string().default('edge.company.com'),

  ADMIN_AUTH_SECRET: secretKey,
  CLIENT_AUTH_SECRET: secretKey,
  ENCRYPTION_KEY: secretKey,
  INTERNAL_API_KEY: z.string().min(16),

  /**
   * A day, and it slides on every request — signing in once covers a day's
   * work. "Keep me signed in" is what stretches it to weeks.
   */
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  SESSION_REMEMBER_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  REAUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
  /** How long an admin has to complete the MFA step after entering their password. */
  /** How long an emailed sign-in passcode stays valid. */
  OTP_TTL_MINUTES: z.coerce.number().int().positive().max(30).default(5),
  /** How long the half-finished sign-in itself survives. */
  OTP_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  /**
   * How long a browser stays "known" after it has cleared the passcode once.
   * Inside the window that browser signs in on the password alone; every other
   * browser still gets a code. `0` turns the whole mechanism off.
   */
  ADMIN_TRUSTED_DEVICE_DAYS: z.coerce.number().int().min(0).max(90).default(1),
  /**
   * Set in production when the API and the frontends live on different
   * subdomains (e.g. `.company.com`), otherwise session cookies are host-only
   * to the API and the frontends can never see them.
   */
  COOKIE_DOMAIN: optionalString,

  COMPANY_ADMIN_EMAIL: z.string().email().default('admin@company.com'),
  COMPANY_ADMIN_PASSWORD: optionalString,

  TENANT_DB_HOST: z.string().min(1),
  TENANT_DB_PORT: port.default(5432),
  TENANT_DB_ADMIN_USER: z.string().min(1),
  TENANT_DB_ADMIN_PASSWORD: z.string().min(1),
  TENANT_DB_SSL: bool.default(false),
  TENANT_DB_NAME_PREFIX: z.string().default('tenant_'),

  R2_ENDPOINT: optionalString,
  R2_ACCESS_KEY: optionalString,
  R2_SECRET_KEY: optionalString,
  R2_BUCKET: optionalString,
  R2_PUBLIC_URL: optionalString,

  PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'sslcommerz']).default('mock'),
  PAYMENT_API_KEY: optionalString,
  PAYMENT_SECRET: optionalString,
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  PAYMENT_CURRENCY: z.string().length(3).default('USD'),

  /** `log` writes the message to the log and sends nothing; `resend` delivers it. */
  MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: optionalString,
  MAIL_FROM_NAME: z.string().default('ShopSaaS'),
  /**
   * Must be an address on a domain verified with the mail provider. Resend
   * rejects anything else, except its own `onboarding@resend.dev` sandbox.
   */
  MAIL_FROM_EMAIL: z.string().email().default('no-reply@company.com'),
  /**
   * Development escape hatch: diverts every message to this one inbox. Resend's
   * sandbox sender only delivers to the account owner, so without this an
   * emailed passcode addressed to anyone else is rejected outright.
   */
  MAIL_DEV_REDIRECT_TO: optionalEmail,
}).superRefine((env, ctx) => {
  // A missing key would otherwise surface as a failed passcode at sign-in time.
  if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RESEND_API_KEY'],
      message: 'is required when MAIL_DRIVER=resend',
    });
  }
  if (env.NODE_ENV === 'production' && env.MAIL_DEV_REDIRECT_TO) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MAIL_DEV_REDIRECT_TO'],
      message: 'must not be set in production — it would divert every customer email',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}
