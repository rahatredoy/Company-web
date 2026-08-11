import { getEnv } from './env';

export { getEnv, envSchema, type Env } from './env';

const env = getEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export const config = {
  env: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,

  database: { url: env.COMPANY_DATABASE_URL },
  redis: { url: env.REDIS_URL },

  api: {
    port: env.API_PORT,
    host: env.API_HOST,
    publicUrl: env.API_PUBLIC_URL,
  },

  urls: {
    website: env.WEBSITE_URL,
    admin: env.ADMIN_URL,
    platformRootDomain: env.PLATFORM_ROOT_DOMAIN,
    clientAdminPattern: env.CLIENT_ADMIN_URL_PATTERN,
    dnsTarget: env.DNS_TARGET,
  },

  /** Browser origins allowed to send credentialed requests. */
  allowedOrigins: [env.WEBSITE_URL, env.ADMIN_URL],

  security: {
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    clientAuthSecret: env.CLIENT_AUTH_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    internalApiKey: env.INTERNAL_API_KEY,
    sessionTtlMinutes: env.SESSION_TTL_MINUTES,
    sessionRememberTtlDays: env.SESSION_REMEMBER_TTL_DAYS,
    adminSessionTtlMinutes: env.ADMIN_SESSION_TTL_MINUTES,
    reauthWindowMinutes: env.REAUTH_WINDOW_MINUTES,
    otpTtlMinutes: env.OTP_TTL_MINUTES,
    otpChallengeTtlMinutes: env.OTP_CHALLENGE_TTL_MINUTES,
    adminTrustedDeviceDays: env.ADMIN_TRUSTED_DEVICE_DAYS,
    cookieDomain: env.COOKIE_DOMAIN,
  },

  bootstrapAdmin: {
    email: env.COMPANY_ADMIN_EMAIL,
    password: env.COMPANY_ADMIN_PASSWORD,
  },

  /** Backend-only. Never surfaced by an endpoint, a log line, or the admin panel. */
  tenantDb: {
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: env.TENANT_DB_ADMIN_USER,
    password: env.TENANT_DB_ADMIN_PASSWORD,
    ssl: env.TENANT_DB_SSL,
    namePrefix: env.TENANT_DB_NAME_PREFIX,
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
    apiKey: env.PAYMENT_API_KEY,
    secret: env.PAYMENT_SECRET,
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
    currency: env.PAYMENT_CURRENCY,
    configured: env.PAYMENT_PROVIDER === 'mock' || Boolean(env.PAYMENT_API_KEY && env.PAYMENT_SECRET),
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
