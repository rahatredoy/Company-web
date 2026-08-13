export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_VERIFIED: 'EMAIL_ALREADY_VERIFIED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  OTP_REQUIRED: 'OTP_REQUIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  ADMIN_ALREADY_EXISTS: 'ADMIN_ALREADY_EXISTS',
  CSRF_FAILED: 'CSRF_FAILED',

  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  ONBOARDING_ALREADY_COMPLETE: 'ONBOARDING_ALREADY_COMPLETE',
  ONBOARDING_STEP_BLOCKED: 'ONBOARDING_STEP_BLOCKED',
  SUBDOMAIN_TAKEN: 'SUBDOMAIN_TAKEN',
  SUBDOMAIN_RESERVED: 'SUBDOMAIN_RESERVED',
  SUBDOMAIN_INVALID: 'SUBDOMAIN_INVALID',

  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  PLAN_DISABLED: 'PLAN_DISABLED',
  PLAN_CODE_TAKEN: 'PLAN_CODE_TAKEN',
  TRIAL_NOT_ACTIVE: 'TRIAL_NOT_ACTIVE',
  TRIAL_NOT_FOUND: 'TRIAL_NOT_FOUND',
  /** The free-trial plan is once per account, for life — and only before a purchase. */
  TRIAL_ALREADY_USED: 'TRIAL_ALREADY_USED',
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_INVALID_STATE: 'SUBSCRIPTION_INVALID_STATE',
  DOWNGRADE_BLOCKED: 'DOWNGRADE_BLOCKED',

  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_DUPLICATE: 'WEBHOOK_DUPLICATE',

  DOMAIN_TAKEN: 'DOMAIN_TAKEN',
  DOMAIN_INVALID: 'DOMAIN_INVALID',
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  DOMAIN_NOT_VERIFIED: 'DOMAIN_NOT_VERIFIED',
  DOMAIN_LIMIT_REACHED: 'DOMAIN_LIMIT_REACHED',
  CUSTOM_DOMAIN_NOT_IN_PLAN: 'CUSTOM_DOMAIN_NOT_IN_PLAN',

  PROVISIONING_IN_PROGRESS: 'PROVISIONING_IN_PROGRESS',
  PROVISIONING_FAILED: 'PROVISIONING_FAILED',
  PROVISIONING_NOT_FOUND: 'PROVISIONING_NOT_FOUND',
  /** Every tenant database shard is at capacity — the platform needs another server. */
  TENANT_CAPACITY_EXHAUSTED: 'TENANT_CAPACITY_EXHAUSTED',
  STORE_NOT_READY: 'STORE_NOT_READY',
  STORE_ADMIN_NOT_FOUND: 'STORE_ADMIN_NOT_FOUND',
  STORE_ADMIN_NOT_VERIFIED: 'STORE_ADMIN_NOT_VERIFIED',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',

  TICKET_CLOSED: 'TICKET_CLOSED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorResponseBody {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, string[]>;
}

/**
 * The only error type route handlers should throw. Anything else is treated as
 * an unexpected internal error and its message is never echoed to the caller.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    options?: { details?: Record<string, string[]>; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options?.details;
  }
}

export const badRequest = (message = 'Invalid request.', code: string = ERROR_CODES.BAD_REQUEST) =>
  new AppError(code, message, 400);

export const unauthorized = (message = 'Authentication required.', code: string = ERROR_CODES.UNAUTHORIZED) =>
  new AppError(code, message, 401);

export const forbidden = (message = 'You do not have access to this resource.', code: string = ERROR_CODES.FORBIDDEN) =>
  new AppError(code, message, 403);

export const notFound = (message = 'Resource not found.', code: string = ERROR_CODES.NOT_FOUND) =>
  new AppError(code, message, 404);

export const conflict = (message = 'Resource already exists.', code: string = ERROR_CODES.CONFLICT) =>
  new AppError(code, message, 409);

export const unprocessable = (message: string, code: string, details?: Record<string, string[]>) =>
  new AppError(code, message, 422, details ? { details } : undefined);

export const rateLimited = (message = 'Too many requests. Please try again later.') =>
  new AppError(ERROR_CODES.RATE_LIMITED, message, 429);

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
