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

/**
 * Set explicitly, or left to follow `NODE_ENV`. Blank counts as unset.
 *
 * Separate from `bool` above because "not set" and "set to false" are different
 * answers here: unset means "do whatever production means", and false is a
 * deliberate opt-out that has to be typed.
 */
const optionalBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) return undefined;
    return typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
  });

/**
 * The tenant database cluster is **sharded**: one PostgreSQL server holds many
 * stores' databases, and a store's own shard is named on its control-plane
 * record. Growth is a matter of appending a server here, not of resizing one.
 *
 * This registry is a deliberate copy of `company-api`'s. Credentials never cross
 * between the two platforms — `/internal/tenants/by-slug` publishes only a shard
 * **id**, and this side turns that id into a connection locally. An id this API
 * does not know is a configuration error, not a request the tenant can cause.
 */
const tenantShards = z
  .string()
  .default('[]')
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a JSON array of shard objects',
      });
      return z.NEVER;
    }
  })
  .pipe(
    z.array(
      z.object({
        id: z.string().trim().min(1).max(40),
        host: z.string().min(1),
        port,
        user: z.string().min(1),
        password: z.string().min(1),
        ssl: bool.default(false),
        /** Unused on this side — placement is the company platform's decision. */
        capacity: z.coerce.number().int().min(0).default(0),
      }),
    ),
  );

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


/**
 * Nothing leaves this process over plaintext, in production.
 *
 * Every value checked here is an address this API either **calls** or **prints
 * into something a browser will follow** — an emailed link, a redirect, a CORS
 * allow-list entry, the origin of an uploaded picture. An `http://` one is not
 * a cosmetic inconsistency: it is a request whose contents anybody on the path
 * can read, and, worse, rewrite. A reset link delivered over http hands the
 * account to whoever is sitting on the coffee-shop wifi; an `http://` image on
 * an `https://` page is mixed content the browser blocks outright.
 *
 * Caught at boot rather than at the first request, because the alternative is a
 * platform that runs perfectly well and is quietly insecure — the failure has no
 * symptom until somebody is already reading the traffic. A misconfigured
 * deployment that refuses to start is the loud version of the same mistake.
 *
 * Development is exempt and has to be: the six apps talk to each other over
 * `http://localhost` on six ports, and there is no network between them.
 */
function requireHttps(
  ctx: z.RefinementCtx,
  key: string,
  value: string | undefined,
  what: string,
): void {
  if (!value) return;
  if (value.startsWith('https://')) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [key],
    message: `must be an https:// address in production — ${what} would otherwise travel in the clear (got ${value.split('://')[0] ?? 'a relative value'}://…)`,
  });
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: port.default(4100),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4100'),

  /**
   * Refuse any request that did not arrive over TLS. See `plugins/https.ts`.
   *
   * Unset follows `NODE_ENV`, which is the answer for every real deployment.
   * Set it to `false` only where the edge already redirects `:80` and does not
   * forward `x-forwarded-proto` — the hook reads that header and would
   * otherwise refuse everything.
   */
  FORCE_HTTPS: optionalBool,
  /**
   * Permit a plaintext connection to PostgreSQL or Redis in production.
   *
   * Deliberately unwieldy to type. TLS on those two is not optional theatre:
   * the tenant databases hold every customer's address and order history, and
   * Redis holds the session tokens that stand in for a password. Set it only
   * when both genuinely sit on a private network the traffic cannot leave —
   * never for a host reached by a public IP.
   */
  ALLOW_PLAINTEXT_DATA_STORES: optionalBool,

  REDIS_URL: z.string().min(1),

  // --- Company control plane -------------------------------------------------
  /** Base URL of company-api. Used for tenant resolution and usage reporting. */
  COMPANY_API_URL: z.string().url().default('http://localhost:4000'),
  /** Must match the company API's INTERNAL_API_KEY exactly. */
  INTERNAL_API_KEY: z.string().min(16),
  /** How long a tenant's status/entitlement lookup is cached. */
  TENANT_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(600).default(60),

  // --- Tenant database cluster ------------------------------------------------
  /**
   * The server that held every tenant database before sharding. Registered as
   * the `legacy` shard, and used for any tenant the control plane names no shard
   * for — which is what an account provisioned before sharding looks like.
   */
  TENANT_DB_HOST: z.string().min(1),
  TENANT_DB_PORT: port.default(5432),
  TENANT_DB_ADMIN_USER: z.string().min(1),
  TENANT_DB_ADMIN_PASSWORD: z.string().min(1),
  TENANT_DB_SSL: bool.default(false),
  TENANT_DB_NAME_PREFIX: z.string().default('tenant_'),
  /** Must list the same ids as company-api's copy. See the comment above. */
  TENANT_SHARDS: tenantShards,

  /**
   * Per-tenant pool size. Small on purpose — hundreds of tenants share one
   * cluster, and a store rarely needs more than a few queries in flight.
   *
   * These two multiply. One instance can hold `TENANT_POOL_CACHE ×
   * TENANT_POOL_MAX` connections open, all of them on whichever shards those
   * tenants happen to live on, so the product has to fit inside a shard's
   * `max_connections` with room to spare for the control plane, the workers and
   * any second instance. The defaults come to 48, which fits PostgreSQL's own
   * default of 100 twice over; `db/connection-budget.ts` checks the real figure
   * against the real servers at boot and says so if it does not.
   *
   * Raising these past a shard's limit is what a connection pooler (PgBouncer in
   * transaction mode) is for — not a larger number here.
   */
  TENANT_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
  /** How many tenant pools stay resident before the least recently used is evicted. */
  TENANT_POOL_CACHE: z.coerce.number().int().min(1).max(500).default(16),
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
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
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

  // --- Text messages (phone sign-in) ------------------------------------------------
  /**
   * `log` writes the message to the API log and sends nothing, which is how a
   * one-time code is read during local development — the same arrangement
   * `MAIL_DRIVER=log` provides for reset links. It is the only value because it
   * is the only driver written; a real gateway is a branch in `lib/sms.ts` and
   * a value added here.
   */
  SMS_DRIVER: z.enum(['log']).default('log'),
  /**
   * What a number typed without a country code is assumed to be dialling from.
   *
   * A shopper types the number the way they dial it, which in Bangladesh is
   * `01712345678` — no country code at all. Something has to supply the missing
   * one before the number can be stored as an identity, and the platform's own
   * market is a far better guess than refusing every number that is not already
   * international.
   */
  SMS_DEFAULT_COUNTRY_CODE: z.string().regex(/^\+?[0-9]{1,4}$/).default('+880'),

  // --- Sign in with Google ----------------------------------------------------------
  /**
   * Both or neither. The storefront only draws the Google button when the API
   * says it is configured, and every Google route refuses outright when it is
   * not — so a half-filled pair is a button that leads to a 503, which is worse
   * than no button.
   *
   * **One redirect URI is registered with Google for the whole platform**:
   * `{API_PUBLIC_URL}/api/v1/oauth/google/callback`. Google matches redirect
   * URIs exactly and has no wildcards, so a per-store URI would mean editing a
   * Google Cloud project every time somebody opened a shop. See
   * `modules/oauth/google.routes.ts` for how the callback finds its way back to
   * the store the shopper actually came from.
   */
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production') {
    requireHttps(ctx, 'API_PUBLIC_URL', env.API_PUBLIC_URL, "this API's own advertised address");
    requireHttps(ctx, 'COMPANY_API_URL', env.COMPANY_API_URL, 'every tenant lookup, which carries INTERNAL_API_KEY');
    requireHttps(ctx, 'ADMIN_URL_PATTERN', env.ADMIN_URL_PATTERN, 'store admin panel links, including password resets');
    requireHttps(ctx, 'STORE_URL_PATTERN', env.STORE_URL_PATTERN, 'storefront links in customer email');
    requireHttps(ctx, 'R2_ENDPOINT', env.R2_ENDPOINT, 'the signed upload, which carries the bucket credential');
    requireHttps(ctx, 'R2_PUBLIC_URL', env.R2_PUBLIC_URL, 'every product picture, on an https page');

    /*
     * The two backing stores.
     *
     * HTTPS at the edge secures the half of the journey the customer can see.
     * A session token read straight off the wire between this API and Redis is
     * the same account taken, and a tenant database reached over plaintext hands
     * over the orders of every store on that shard. `rediss://` is Redis over
     * TLS; PostgreSQL wants `sslmode` on the URL or `ssl: true` on the shard.
     */
    if (!env.ALLOW_PLAINTEXT_DATA_STORES) {
      if (!env.REDIS_URL.startsWith('rediss://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message:
            'must use rediss:// (Redis over TLS) in production — it holds the session tokens that stand in for a password. Set ALLOW_PLAINTEXT_DATA_STORES=true only if Redis is on a private network.',
        });
      }

      const plaintextShards = [
        ...(env.TENANT_DB_SSL ? [] : ['TENANT_DB_SSL']),
        ...env.TENANT_SHARDS.filter((shard) => !shard.ssl).map((shard) => shard.id),
      ];
      if (plaintextShards.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TENANT_SHARDS'],
          message: `every shard must set "ssl": true in production — these do not: ${plaintextShards.join(', ')}. Tenant databases hold customer addresses and order history. Set ALLOW_PLAINTEXT_DATA_STORES=true only if the cluster is on a private network.`,
        });
      }
    }
  }

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
