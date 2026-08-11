import { getEnv } from './env';

export { getEnv, envSchema, type Env } from './env';

const env = getEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export const config = {
  env: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,

  api: {
    port: env.API_PORT,
    host: env.API_HOST,
    publicUrl: env.API_PUBLIC_URL,
  },

  redis: { url: env.REDIS_URL },

  company: {
    apiUrl: env.COMPANY_API_URL.replace(/\/$/, ''),
    internalApiKey: env.INTERNAL_API_KEY,
    cacheTtlSeconds: env.TENANT_CACHE_TTL_SECONDS,
  },

  /** Backend-only. Never surfaced by an endpoint, a log line, or the admin panel. */
  tenantDb: {
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: env.TENANT_DB_ADMIN_USER,
    password: env.TENANT_DB_ADMIN_PASSWORD,
    ssl: env.TENANT_DB_SSL,
    namePrefix: env.TENANT_DB_NAME_PREFIX,
    poolMax: env.TENANT_POOL_MAX,
    poolCache: env.TENANT_POOL_CACHE,
    poolIdleMinutes: env.TENANT_POOL_IDLE_MINUTES,
  },

  urls: {
    platformRootDomain: env.PLATFORM_ROOT_DOMAIN,
    adminUrlPattern: env.ADMIN_URL_PATTERN,
    storeUrlPattern: env.STORE_URL_PATTERN,
  },

  /** Local-only fallback so the panel is reachable without wildcard DNS. */
  devStoreSlug: isProduction ? undefined : env.DEV_STORE_SLUG,

  security: {
    storeAuthSecret: env.STORE_AUTH_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    cookieDomain: env.COOKIE_DOMAIN,
    sessionTtlMinutes: env.SESSION_TTL_MINUTES,
    sessionRememberTtlDays: env.SESSION_REMEMBER_TTL_DAYS,
    reauthWindowMinutes: env.REAUTH_WINDOW_MINUTES,
    mfaChallengeTtlMinutes: env.MFA_CHALLENGE_TTL_MINUTES,
  },

  storage: {
    endpoint: env.R2_ENDPOINT,
    accessKey: env.R2_ACCESS_KEY,
    secretKey: env.R2_SECRET_KEY,
    bucket: env.R2_BUCKET,
    publicUrl: env.R2_PUBLIC_URL,
    configured: Boolean(env.R2_ENDPOINT && env.R2_ACCESS_KEY && env.R2_SECRET_KEY && env.R2_BUCKET),
  },

  payment: {
    provider: env.PAYMENT_PROVIDER,
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
    currency: env.PAYMENT_CURRENCY,
  },

  mail: {
    driver: env.MAIL_DRIVER,
    resendApiKey: env.RESEND_API_KEY,
    fromName: env.MAIL_FROM_NAME,
    fromEmail: env.MAIL_FROM_EMAIL,
    devRedirectTo: env.MAIL_DEV_REDIRECT_TO,
    configured: env.MAIL_DRIVER === 'log' || Boolean(env.RESEND_API_KEY),
  },
} as const;

export type Config = typeof config;
