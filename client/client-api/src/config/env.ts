import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walk up from this file until a `.env` is found (containers inject real env vars instead). */
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

  API_PORT: port.default(4100),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4100'),

  REDIS_URL: z.string().min(1),

  // --- Company control plane -------------------------------------------------
  /** Base URL of company-api. Used for tenant resolution and usage reporting. */
  COMPANY_API_URL: z.string().url().default('http://localhost:4000'),
  /** Must match the company API's INTERNAL_API_KEY exactly. */
  INTERNAL_API_KEY: z.string().min(16),
  /** How long a tenant's status/entitlement lookup is cached. */
  TENANT_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(600).default(60),

  // --- Tenant database cluster ------------------------------------------------
  TENANT_DB_HOST: z.string().min(1),
  TENANT_DB_PORT: port.default(5432),
  TENANT_DB_ADMIN_USER: z.string().min(1),
  TENANT_DB_ADMIN_PASSWORD: z.string().min(1),
  TENANT_DB_SSL: bool.default(false),
  TENANT_DB_NAME_PREFIX: z.string().default('tenant_'),

  /** Per-tenant pool size. Small on purpose — hundreds of tenants share one cluster. */
  TENANT_POOL_MAX: z.coerce.number().int().min(1).max(20).default(4),
  /** How many tenant pools stay resident before the least recently used is evicted. */
  TENANT_POOL_CACHE: z.coerce.number().int().min(1).max(500).default(50),
  /** Idle pools older than this are closed. */
  TENANT_POOL_IDLE_MINUTES: z.coerce.number().int().min(1).max(120).default(10),

  // --- Addressing --------------------------------------------------------------
  PLATFORM_ROOT_DOMAIN: z.string().default('company.com'),
  /** Where the store admin panel lives; `{slug}` is substituted. */
  ADMIN_URL_PATTERN: z.string().default('http://{slug}.localhost:3002'),
  /** Where the customer-facing storefront lives; `{slug}` is substituted. */
  STORE_URL_PATTERN: z.string().default('http://{slug}.localhost:3003'),
  /**
   * Local development escape hatch. When set, requests without a resolvable
   * store host fall back to this slug. Must never be set in production.
   */
  DEV_STORE_SLUG: optionalString,

  // --- Auth ---------------------------------------------------------------------
  STORE_AUTH_SECRET: secretKey,
  ENCRYPTION_KEY: secretKey,
  COOKIE_DOMAIN: optionalString,

  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  SESSION_REMEMBER_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REAUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  MFA_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // --- Object storage -------------------------------------------------------------
  R2_ENDPOINT: optionalString,
  R2_ACCESS_KEY: optionalString,
  R2_SECRET_KEY: optionalString,
  R2_BUCKET: optionalString,
  R2_PUBLIC_URL: optionalString,

  // --- Store payment gateway (customer orders, not SaaS billing) ------------------
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'sslcommerz']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  PAYMENT_CURRENCY: z.string().length(3).default('USD'),

  // --- Email ------------------------------------------------------------------------
  /** `log` writes the message to the log and sends nothing; `resend` delivers it. */
  MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: optionalString,
  MAIL_FROM_NAME: z.string().default('ShopSaaS Stores'),
  /**
   * Must be an address on a domain verified with the mail provider. Store mail
   * carries the store's name as the display name, but never its own address —
   * one verified platform domain signs for every tenant.
   */
  MAIL_FROM_EMAIL: z.string().email().default('no-reply@company.com'),
  /**
   * Development escape hatch: diverts every message to this one inbox. Resend's
   * sandbox sender only delivers to the account owner, so without this a reset
   * link addressed to a store admin is rejected outright.
   */
  MAIL_DEV_REDIRECT_TO: optionalEmail,
}).superRefine((env, ctx) => {
  // A missing key would otherwise surface as an undelivered reset link.
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
      message: 'must not be set in production — it would divert every store owner email',
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
