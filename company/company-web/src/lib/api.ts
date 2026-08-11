import { publicEnv } from './env';

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

  /** First message for a given form field, if the API reported one. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Server components must forward the incoming cookie header explicitly. */
  cookieHeader?: string;
  /** Next.js caching hints — only meaningful for public, unauthenticated reads. */
  next?: { revalidate?: number | false; tags?: string[] };
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, publicEnv.apiUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Thin fetch wrapper. Cookies carry the session, so every call is credentialed
 * and no token is ever written to localStorage.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, cookieHeader, headers, next, cache, ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (cookieHeader) requestHeaders.set('cookie', cookieHeader);

  // `next.revalidate` and `cache: 'no-store'` are mutually exclusive, so a
  // caller asking for revalidation opts out of the default no-store.
  const cacheInit: RequestInit & { next?: RequestOptions['next'] } = next
    ? { next }
    : { cache: cache ?? 'no-store' };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      ...cacheInit,
      method,
      headers: requestHeaders,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and try again.',
    });
  }

  if (response.status === 204) return undefined as T;

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
    const body = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, {
      code: body.code ?? 'INTERNAL_ERROR',
      message: body.message ?? 'Something went wrong. Please try again.',
      requestId: body.requestId,
      details: body.details,
    });
  }

  const envelope = payload as { data?: T } | null;
  return (envelope && 'data' in envelope ? (envelope.data as T) : (payload as T));
}

export async function apiFetchPaginated<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const { method = 'GET', body, query, cookieHeader, headers, ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (cookieHeader) requestHeaders.set('cookie', cookieHeader);

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    method,
    headers: requestHeaders,
    credentials: 'include',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T[]; meta?: { page: number; pageSize: number; total: number; totalPages: number } }
    | (ApiErrorBody & { data?: undefined })
    | null;

  if (!response.ok) {
    const body = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, {
      code: body.code ?? 'INTERNAL_ERROR',
      message: body.message ?? 'Something went wrong. Please try again.',
      requestId: body.requestId,
      details: body.details,
    });
  }

  return {
    data: (payload?.data as T[]) ?? [],
    meta: (payload as { meta?: { page: number; pageSize: number; total: number; totalPages: number } })?.meta ?? {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    },
  };
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** The API's machine-readable code, for the cases where the message is not enough. */
export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}
