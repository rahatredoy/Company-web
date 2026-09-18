export const ERROR_CODES = {
  // --- generic ---------------------------------------------------------------
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** A keyset cursor that did not decode — tampered with, or from an older build. */
  INVALID_CURSOR: 'INVALID_CURSOR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** The request arrived over plaintext HTTP. See `plugins/https.ts`. */
  HTTPS_REQUIRED: 'HTTPS_REQUIRED',

  // --- tenant resolution -------------------------------------------------------
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  STORE_NOT_READY: 'STORE_NOT_READY',
  STORE_SUSPENDED: 'STORE_SUSPENDED',
  STORE_EXPIRED: 'STORE_EXPIRED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  TENANT_UNAVAILABLE: 'TENANT_UNAVAILABLE',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  FEATURE_NOT_IN_PLAN: 'FEATURE_NOT_IN_PLAN',

  // --- store admin auth ---------------------------------------------------------
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** Provisioning has not put a password on the store's admin account yet. */
  ACCOUNT_NOT_READY: 'ACCOUNT_NOT_READY',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
  MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CSRF_FAILED: 'CSRF_FAILED',
  LAST_SUPER_ADMIN: 'LAST_SUPER_ADMIN',
  CANNOT_EDIT_SELF: 'CANNOT_EDIT_SELF',

  // --- catalog -------------------------------------------------------------------
  SLUG_TAKEN: 'SLUG_TAKEN',
  SKU_TAKEN: 'SKU_TAKEN',
  BARCODE_TAKEN: 'BARCODE_TAKEN',
  CATEGORY_HAS_CHILDREN: 'CATEGORY_HAS_CHILDREN',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  BRAND_IN_USE: 'BRAND_IN_USE',
  ATTRIBUTE_IN_USE: 'ATTRIBUTE_IN_USE',
  PRODUCT_HAS_ORDERS: 'PRODUCT_HAS_ORDERS',
  VARIANT_REQUIRED: 'VARIANT_REQUIRED',

  // --- inventory -------------------------------------------------------------------
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVENTORY_LEVEL_NOT_FOUND: 'INVENTORY_LEVEL_NOT_FOUND',
  WAREHOUSE_IN_USE: 'WAREHOUSE_IN_USE',
  DEFAULT_WAREHOUSE_REQUIRED: 'DEFAULT_WAREHOUSE_REQUIRED',

  // --- orders -----------------------------------------------------------------------
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  ORDER_ALREADY_CANCELLED: 'ORDER_ALREADY_CANCELLED',

  // --- returns & refunds --------------------------------------------------------------
  RETURN_NOT_FOUND: 'RETURN_NOT_FOUND',
  RETURN_WINDOW_CLOSED: 'RETURN_WINDOW_CLOSED',
  RETURN_QUANTITY_EXCEEDED: 'RETURN_QUANTITY_EXCEEDED',
  PRODUCT_NOT_RETURNABLE: 'PRODUCT_NOT_RETURNABLE',
  REFUND_NOT_FOUND: 'REFUND_NOT_FOUND',
  REFUND_EXCEEDS_REMAINING: 'REFUND_EXCEEDS_REMAINING',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_DUPLICATE: 'WEBHOOK_DUPLICATE',

  // --- marketing ------------------------------------------------------------------------
  DISCOUNT_CODE_TAKEN: 'DISCOUNT_CODE_TAKEN',
  /** A code the shopper entered does not apply to this order; `message` says why in their terms. */
  DISCOUNT_NOT_APPLICABLE: 'DISCOUNT_NOT_APPLICABLE',
  /** The last use of a limited discount was taken by another order while this one was being placed. */
  DISCOUNT_LIMIT_REACHED: 'DISCOUNT_LIMIT_REACHED',
  /** A bank offer names a bank with no card prefixes on file, so no card could ever match it. */
  DISCOUNT_BANK_UNVERIFIABLE: 'DISCOUNT_BANK_UNVERIFIABLE',
  BANK_IN_USE: 'BANK_IN_USE',

  // --- content ---------------------------------------------------------------------------
  PAGE_SLUG_TAKEN: 'PAGE_SLUG_TAKEN',
  INVALID_TEMPLATE: 'INVALID_TEMPLATE',
  INVALID_THEME: 'INVALID_THEME',

  // --- settings ---------------------------------------------------------------------------
  /** Not an ISO 4217 code in circulation. See `lib/currencies.ts`. */
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  /**
   * A store that has taken orders changed its currency without saying it knew
   * what that does. Asked for again with `confirmCurrencyChange: true`.
   */
  CURRENCY_CHANGE_UNCONFIRMED: 'CURRENCY_CHANGE_UNCONFIRMED',

  // --- storage ----------------------------------------------------------------------------
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  UPLOAD_TOO_LARGE: 'UPLOAD_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
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

export const unauthorized = (message = 'Sign in to continue.', code: string = ERROR_CODES.UNAUTHORIZED) =>
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
