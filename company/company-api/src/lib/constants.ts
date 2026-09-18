export const RESERVED_SUBDOMAINS = [
  'admin', 'api', 'app', 'www', 'support', 'billing', 'system', 'company', 'security',
  'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'status', 'dashboard', 'account',
  'accounts', 'login', 'signup', 'register', 'help', 'docs', 'blog', 'store', 'shop',
  'checkout', 'payment', 'payments', 'webhook', 'webhooks', 'internal', 'staging',
  'test', 'dev', 'demo', 'root', 'null', 'undefined',
] as const;

/** Hostnames that must never be attached as a client custom domain. */
export const BLOCKED_DOMAIN_SUFFIXES = [
  'localhost', '.local', '.internal', '.localdomain', '.test', '.example', '.invalid', '.onion',
] as const;

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 40;

export const SESSION_COOKIE = {
  /** Credentials AND emailed passcode proven. Only this satisfies `requireClient`. */
  client: 'company_client_session',
  /** Client credentials proven, passcode still pending. Short-lived, reaches nothing. */
  clientOtp: 'company_client_otp',
  /** Credentials AND emailed passcode proven. Only this satisfies `requireAdmin`. */
  admin: 'company_admin_session',
  /** Credentials proven, passcode still pending. Short-lived, cannot reach admin routes. */
  adminOtp: 'company_admin_otp',
  /**
   * Marks a browser that has cleared the passcode before. It authenticates
   * nothing on its own — it only lets a *correct password* finish sign-in
   * without a fresh code.
   */
  adminDevice: 'company_admin_device',
  csrf: 'company_csrf',
} as const;

/**
 * The `aud` claim on every session JWT this API issues.
 *
 * A challenge token gets an audience of its own rather than a flag inside a
 * shared one: `verifyJwt` is given the single audience it will accept, so a
 * half-finished sign-in presented to a protected route does not merely fail a
 * check further in — it fails to verify at all.
 */
export const AUTH_AUDIENCE = {
  admin: 'company-admin',
  adminOtp: 'company-admin-otp',
  client: 'company-client',
  clientOtp: 'company-client-otp',
} as const;

export const PROVISIONING_STEPS = [
  'tenant_record',
  'tenant_database',
  'tenant_schema',
  'store_configuration',
  'store_admin',
  'platform_subdomain',
  'store_ready',
] as const;

export type ProvisioningStepName = (typeof PROVISIONING_STEPS)[number];

export const PROVISIONING_STEP_LABELS: Record<ProvisioningStepName, string> = {
  tenant_record: 'Tenant Created',
  tenant_database: 'Database Created',
  tenant_schema: 'Schema Migrated',
  store_configuration: 'Initial Setup',
  store_admin: 'Client Admin Created',
  platform_subdomain: 'Subdomain Created',
  store_ready: 'Store Ready',
};

/**
 * The trial is short on purpose, and it is not a way past billing: the plan is
 * still chosen and its 0.00 bill still paid before the store is built. Reminders
 * are scaled to the length — a 10-day warning inside a 7-day trial never fires.
 */
export const DEFAULT_TRIAL_DAYS = 7;
export const DEFAULT_TRIAL_REMINDER_DAYS = [3, 1];


export const LOGIN_LOCK_THRESHOLD = 10;
export const LOGIN_LOCK_MINUTES = 15;
/** Delay in ms applied after N consecutive failures (index = failure count). */
export const LOGIN_BACKOFF_MS = [0, 0, 250, 750, 1_500, 3_000, 5_000];

export const TOKEN_TTL = {
  /**
   * Longer than a sign-in passcode: a new customer often steps away between
   * pressing "Create account" and opening their inbox, and there is nothing to
   * steal here beyond an account with no store on it yet.
   */
  emailVerificationMinutes: 30,
  passwordResetMinutes: 60,
} as const;

export const RATE_LIMITS = {
  register: { max: 5, windowSeconds: 900 },
  login: { max: 10, windowSeconds: 900 },
  adminLogin: { max: 5, windowSeconds: 900 },
  otpVerify: { max: 8, windowSeconds: 900 },
  otpResend: { max: 5, windowSeconds: 900 },
  clientOtpVerify: { max: 10, windowSeconds: 900 },
  clientOtpResend: { max: 5, windowSeconds: 900 },
  forgotPassword: { max: 5, windowSeconds: 900 },
  resendVerification: { max: 3, windowSeconds: 900 },
  verifyEmail: { max: 15, windowSeconds: 900 },
  subdomainCheck: { max: 40, windowSeconds: 300 },
  checkout: { max: 12, windowSeconds: 900 },
  /** Confirming, and later resetting, the store admin panel login. */
  storeAdminOtp: { max: 10, windowSeconds: 900 },
  storeAdminOtpResend: { max: 5, windowSeconds: 900 },
  storeAdminOtpVerify: { max: 10, windowSeconds: 900 },
  domainVerify: { max: 10, windowSeconds: 900 },
  domainCreate: { max: 10, windowSeconds: 3600 },
  supportCreate: { max: 12, windowSeconds: 3600 },
  contact: { max: 5, windowSeconds: 3600 },
  reauth: { max: 8, windowSeconds: 900 },
  recoveryCodes: { max: 3, windowSeconds: 3600 },
} as const;

export const SETTING_KEYS = {
  general: 'general',
  trial: 'trial',
  email: 'email',
  messaging: 'messaging',
} as const;

export const STOREFRONT_TEMPLATES = [
  'marketplace',
  'modern-shop',
  'fashion-boutique',
  'minimal-store',
  'electronics',
  'lifestyle',
] as const;
