import { publicConfig } from '@/config';
import { apiBaseForHost } from '@/lib/tenant/host';

/**
 * The single place this storefront talks to the Commerce API.
 *
 * Nothing else in the app calls `fetch` against the backend — scattered fetches
 * are how inconsistent error handling, missing credentials and forgotten tenant
 * headers creep in.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || 'Request failed.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code || 'INTERNAL_ERROR';
    this.details = body.details;
    this.requestId = body.requestId;
  }

  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

/** Store lifecycle problems the shell renders as whole-page states. */
export const STORE_BLOCKED_CODES = new Set([
  'STORE_SUSPENDED',
  'STORE_EXPIRED',
  'STORE_NOT_READY',
  'TENANT_UNAVAILABLE',
]);

export const STORE_NOT_FOUND_CODES = new Set(['STORE_NOT_FOUND']);

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Server components must forward the visitor's cookies explicitly. */
  cookieHeader?: string;
  /** Names the store when the hostname cannot (development only). */
  storeSlug?: string;
  /**
   * Which API origin to call. Server code must pass this — there is no
   * `window.location` to read the visitor's hostname from, and the hostname is
   * how the API identifies the store. `lib/tenant#storeCall` returns it
   * alongside `storeSlug` so the pair is always set together.
   */
  baseUrl?: string;
  headers?: Record<string, string>;
  /** Only ever set for public, visitor-independent reads. */
  revalidate?: number | false;
  tags?: string[];
  signal?: AbortSignal;
  /**
   * Turns a 404 into `null` instead of a thrown `ApiError`.
   *
   * For a detail page — a product, a CMS page, an order — "no such thing" is a
   * page to render, not a failure. Without this every such caller wraps the
   * call in a try/catch that has to re-inspect the status, and one of them
   * eventually swallows a real error along with the 404.
   */
  allowNotFound?: boolean;
}

/**
 * Which origin this request goes to.
 *
 * In the browser the visitor's own hostname is the answer. On the server there
 * is no `window.location`, so the caller passes the value `lib/tenant#storeCall`
 * derived from the incoming request.
 */
function apiBase(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof window !== 'undefined') return apiBaseForHost(window.location.host);
  return publicConfig.apiUrl;
}

function buildUrl(path: string, query: Query | undefined, baseUrl?: string): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, apiBase(baseUrl));

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const entry of value) url.searchParams.append(key, entry);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    cookieHeader,
    storeSlug,
    baseUrl,
    headers,
    revalidate,
    tags,
    signal,
    allowNotFound = false,
  } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  // A form (a file upload) sets its own multipart boundary; anything else is JSON.
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) requestHeaders.set('Content-Type', 'application/json');
  if (cookieHeader) requestHeaders.set('cookie', cookieHeader);
  if (storeSlug) requestHeaders.set('X-Store-Slug', storeSlug);

  /*
   * Caching is opt-in and only for public reads. A cart, an account or an order
   * must never sit in a shared cache — one customer receiving another's
   * response is the worst bug this file could allow.
   */
  const cacheInit: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } } =
    revalidate === undefined
      ? { cache: 'no-store' }
      : { next: { revalidate, ...(tags ? { tags } : {}) } };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query, baseUrl), {
      ...cacheInit,
      method,
      headers: requestHeaders,
      credentials: 'include',
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'We could not reach the store. Check your connection and try again.',
    });
  }

  if (response.status === 204) return undefined as T;
  if (response.status === 404 && allowNotFound) return null as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorBody = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, {
      code: errorBody.code ?? 'INTERNAL_ERROR',
      // Backend messages are already customer-safe; anything missing falls back
      // to a neutral line rather than exposing a status code or a stack.
      message: errorBody.message ?? 'Something went wrong. Please try again.',
      requestId: errorBody.requestId,
      details: errorBody.details,
    });
  }

  const envelope = payload as { data?: T } | null;
  return envelope && typeof envelope === 'object' && 'data' in envelope
    ? (envelope.data as T)
    : (payload as T);
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function apiFetchPaginated<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Paginated<T>> {
  const result = await apiFetch<Paginated<T> | T[]>(path, options);

  if (Array.isArray(result)) {
    return {
      data: result,
      meta: { page: 1, pageSize: result.length, total: result.length, totalPages: 1 },
    };
  }

  return result;
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/**
 * `{ email: ['Taken.'] }` → `{ email: 'Taken.' }`.
 *
 * The API reports every message it has for a field, because a panel can afford
 * to list them. A storefront form shows one line under one input, and every
 * form on this side is typed for a single string — without this the field would
 * render the array.
 */
export function flattenDetails(details: unknown): Record<string, string> | undefined {
  if (!details || typeof details !== 'object') return undefined;

  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') flat[key] = first;
  }

  return Object.keys(flat).length > 0 ? flat : undefined;
}

/** Never surfaces a status code, a request path or a stack to a customer. */
export function errorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

export function isStoreUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && STORE_BLOCKED_CODES.has(code);
}

export function isStoreNotFound(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && STORE_NOT_FOUND_CODES.has(code);
}
