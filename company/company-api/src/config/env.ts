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
 * stores' databases, and a new store is placed on whichever shard still has
 * room. Growth is a matter of appending a server here, not of resizing one.
 *
 * JSON rather than numbered variables, so adding a shard is one edit and the
 * whole registry parses or fails as a unit at boot.
 *
 * `client-api` carries an identical copy of this list. Credentials are never
 * transmitted between the two platforms — the internal tenant lookup publishes
 * only a shard **id**, which each side resolves against its own registry.
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
        /**
         * How many stores this shard accepts. `0` keeps it serving the stores it
         * already holds while taking no new ones — which is how a shard is
         * drained, and how the pre-sharding server stays readable.
         */
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
 * into something a browser will follow** — an emailed sign-in passcode, a
 * gateway return URL, a CORS allow-list entry. An `http://` one is not a
 * cosmetic inconsistency: it is a request whose contents anybody on the path can
 * read and, worse, rewrite. This is the control plane, so what is on that wire
 * is billing, provisioning and the platform's single super-admin session.
 *
 * `WEBSITE_URL` and `ADMIN_URL` are the CORS allow-list as well as the link
 * base, so an http entry there is also a browser origin this API would accept
 * credentialed requests from.
 *
 * Caught at boot rather than at the first request, because the alternative is a
 * platform that runs perfectly well and is quietly insecure — the failure has no
 * symptom until somebody is already reading the traffic.
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

  COMPANY_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  API_PORT: port.default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

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
   * Deliberately unwieldy to type. `company_control_db` holds every account,
   * subscription and invoice on the platform, and Redis holds the session
   * tokens that stand in for a password. Set it only when both genuinely sit on
   * a private network the traffic cannot leave — never for a host reached by a
   * public IP.
   */
  ALLOW_PLAINTEXT_DATA_STORES: optionalBool,

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

  /**
   * The server that held every tenant database before sharding, and still the
   * answer for any tenant whose row names no shard. It is registered as the
   * `legacy` shard at zero capacity, so it keeps serving what it has and is
   * never chosen for a new store.
   */
  TENANT_DB_HOST: z.string().min(1),
  TENANT_DB_PORT: port.default(5432),
  TENANT_DB_ADMIN_USER: z.string().min(1),
  TENANT_DB_ADMIN_PASSWORD: z.string().min(1),
  TENANT_DB_SSL: bool.default(false),
  TENANT_DB_NAME_PREFIX: z.string().default('tenant_'),
  /** Where new stores are placed. See the `tenantShards` comment above. */
  TENANT_SHARDS: tenantShards,

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
  if (env.NODE_ENV === 'production') {
    requireHttps(ctx, 'API_PUBLIC_URL', env.API_PUBLIC_URL, "this API's own advertised address");
    requireHttps(ctx, 'WEBSITE_URL', env.WEBSITE_URL, 'every emailed link, and a CORS origin this API trusts');
    requireHttps(ctx, 'ADMIN_URL', env.ADMIN_URL, 'the super-admin panel, and a CORS origin this API trusts');
    requireHttps(ctx, 'CLIENT_ADMIN_URL_PATTERN', env.CLIENT_ADMIN_URL_PATTERN, 'the store admin panel address given to every new owner');
    requireHttps(ctx, 'R2_ENDPOINT', env.R2_ENDPOINT, 'the signed upload, which carries the bucket credential');
    requireHttps(ctx, 'R2_PUBLIC_URL', env.R2_PUBLIC_URL, 'every uploaded file, on an https page');

    /*
     * The two backing stores.
     *
     * HTTPS at the edge secures the half of the journey the customer can see.
     * A session token read straight off the wire between this API and Redis is
     * the same account taken, and `company_control_db` reached over plaintext is
     * every account, subscription and invoice on the platform. `rediss://` is
     * Redis over TLS; PostgreSQL wants `sslmode` on the connection string.
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

      /*
       * Read as a value rather than matched as a boundary: `sslmode` also
       * takes `disable`, `allow` and `prefer`, and the last two are the
       * dangerous ones — they *try* TLS and fall back to plaintext without
       * saying so, which is the failure this check exists to catch.
       */
      const sslmode = /[?&]sslmode=([a-z-]+)/i.exec(env.COMPANY_DATABASE_URL)?.[1]?.toLowerCase();
      if (!sslmode || !['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COMPANY_DATABASE_URL'],
          message:
            'must carry ?sslmode=require (or verify-full) in production — it holds every account, subscription and invoice on the platform. Set ALLOW_PLAINTEXT_DATA_STORES=true only if the database is on a private network.',
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
          message: `every shard must set "ssl": true in production — these do not: ${plaintextShards.join(', ')}. Provisioning writes each new store's admin credential over this connection. Set ALLOW_PLAINTEXT_DATA_STORES=true only if the cluster is on a private network.`,
        });
      }
    }
  }

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
