import { apiBaseForHost, isDevSlugMode, publicEnv } from './env';
import { resolveLanguage } from './i18n/languages';
import { DICTIONARIES, type MessageKey } from './i18n/messages';
import { slugFromHost } from './store-slug';

/**
 * The few words this module says itself — a request that never reached the API,
 * or an answer with no message in it. Everything else in an error is the API's,
 * which arrives already in the store's language.
 *
 * No hook here: this module runs on both sides of the boundary. In the browser
 * the page's `<html lang>` — which the root layout sets from the store's
 * language — says which dictionary; on the server it is English.
 */
function localText(key: MessageKey): string {
  if (typeof document === 'undefined') return key;
  const language = resolveLanguage(document.documentElement.lang);
  return DICTIONARIES[language]?.[key] ?? key;
}

/**
 * Names the store for the API when the hostname alone cannot.
 *
 * In production the panel lives at `admin.<slug>.company.com` and the API at a
 * hostname carrying the same slug, so the `Host` header is enough and this adds
 * nothing. In development neither Windows nor Node resolves `*.localhost`, so
 * the slug travels in a header that the API honours only while its own
 * `DEV_STORE_SLUG` is set.
 */
function devStoreHeader(): Record<string, string> {
  if (!publicEnv.devStoreSlug) return {};
  const fromHost =
    typeof window === 'undefined' ? null : slugFromHost(window.location.host, publicEnv.rootDomain);
  return { 'X-Store-Slug': fromHost ?? publicEnv.devStoreSlug };
}

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
    super(body.message || localText('Request failed.'));
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
  /**
   * Which API origin to call. Server components must pass this, because there is
   * no `window.location` to read the visitor's hostname from and the hostname is
   * how the API identifies the store. See `env.ts#apiBaseForHost`.
   */
  baseUrl?: string;
  /** Next.js caching hints — only meaningful for public, unauthenticated reads. */
  next?: { revalidate?: number | false; tags?: string[] };
}

/**
 * Which origin this request goes to.
 *
 * In the browser the visitor's own hostname is the answer — `apiBaseForHost`
 * turns it into the API address that names this store, which is the only thing
 * the API can identify a tenant from. On the server there is no
 * `window.location`, so `server-api.ts` reads the incoming request's host and
 * passes the result down as `baseUrl`.
 *
 * Development is the one case that ignores all of that. The panel is reached at
 * `<slug>.localhost:3002` while the API answers on `localhost:4100`, and those
 * are two different registrable domains — `<slug>.localhost` and `localhost` —
 * so the browser files the API as third party and silently drops its
 * `SameSite=Lax` session cookie. Sign-in returns 200, the cookie never lands,
 * and the dashboard bounces straight back to the sign-in page. So in
 * development the browser talks to the panel's own origin and `next.config.ts`
 * rewrites `/api/*` through: same site, cookie kept. Server components are
 * unaffected — they forward the cookie by hand and have no origin to be
 * same-site with, so they call the API directly.
 */
function apiBase(explicit?: string): string {
  if (typeof window !== 'undefined') {
    if (isDevSlugMode) return window.location.origin;
    return apiBaseForHost(window.location.host);
  }
  return explicit ?? publicEnv.apiUrl;
}

function buildUrl(path: string, query: Query | undefined, baseUrl?: string): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, apiBase(baseUrl));
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
  const { method = 'GET', body, query, cookieHeader, baseUrl, headers, next, cache, ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (cookieHeader) requestHeaders.set('cookie', cookieHeader);
  for (const [key, value] of Object.entries(devStoreHeader())) {
    if (!requestHeaders.has(key)) requestHeaders.set(key, value);
  }

  // `next.revalidate` and `cache: 'no-store'` are mutually exclusive, so a
  // caller asking for revalidation opts out of the default no-store.
  const cacheInit: RequestInit & { next?: RequestOptions['next'] } = next
    ? { next }
    : { cache: cache ?? 'no-store' };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query, baseUrl), {
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
      message: localText('Cannot reach the server. Check your connection and try again.'),
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
      message: body.message ?? localText('Something went wrong. Please try again.'),
      requestId: body.requestId,
      details: body.details,
    });
  }

  const envelope = payload as { data?: T } | null;
  return (envelope && 'data' in envelope ? (envelope.data as T) : (payload as T));
}

/**
 * The envelope every admin list answers with (`lib/http.ts#listed` on the API
 * side). It replaced the numbered `{ page, totalPages }` one when the panel
 * moved from paging to scrolling.
 *
 * `total` is counted on the first batch only — the count is the half of a list
 * read that cannot stop at `pageSize`, so a cursor batch omits it rather than
 * paying for it again. A caller therefore has to *keep* the first answer rather
 * than read it off the batch in hand; `useInfiniteList` does.
 */
/**
 * Uploads one file to `POST /admin/uploads` and returns its public address.
 *
 * Not `apiFetch`: that sets a JSON content type, and a multipart body needs the
 * browser to write its own header so the boundary is included. It still has to
 * go to the same origin with the same store header as every other call — an
 * upload posted to the raw `{slug}` pattern names no store and is refused as
 * `STORE_NOT_FOUND`.
 */
export async function uploadFile(purpose: string, file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);

  let response: Response;
  try {
    response = await fetch(buildUrl('/api/v1/admin/uploads', { purpose }), {
      method: 'POST',
      body,
      headers: { Accept: 'application/json', ...devStoreHeader() },
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: localText('Cannot reach the server. Check your connection and try again.'),
    });
  }

  const payload = (await response.json().catch(() => null)) as
    | ({ data?: { url?: string } } & Partial<ApiErrorBody>)
    | null;
  if (!response.ok || !payload?.data?.url) {
    throw new ApiError(response.status, {
      code: payload?.code ?? 'INTERNAL_ERROR',
      message: payload?.message ?? '',
      requestId: payload?.requestId,
      details: payload?.details,
    });
  }
  return payload.data.url;
}

export interface ListMeta {
  pageSize: number;
  /** Opaque marker for the row after the last one sent; null when the list ends. */
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

/**
 * Its own fetch rather than a call to `apiFetch`: `apiFetch` unwraps `data` and
 * throws the envelope away, and `meta` is the half of a list response that says
 * whether there is another batch and where it starts.
 */
export async function apiFetchListed<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T[]; meta: ListMeta }> {
  const { method = 'GET', body, query, cookieHeader, baseUrl, headers, ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (cookieHeader) requestHeaders.set('cookie', cookieHeader);
  for (const [key, value] of Object.entries(devStoreHeader())) {
    if (!requestHeaders.has(key)) requestHeaders.set(key, value);
  }

  const response = await fetch(buildUrl(path, query, baseUrl), {
    ...rest,
    method,
    headers: requestHeaders,
    credentials: 'include',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T[]; meta?: ListMeta }
    | (ApiErrorBody & { data?: undefined })
    | null;

  if (!response.ok) {
    const failure = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, {
      code: failure.code ?? 'INTERNAL_ERROR',
      message: failure.message ?? localText('Something went wrong. Please try again.'),
      requestId: failure.requestId,
      details: failure.details,
    });
  }

  return {
    data: (payload as { data?: T[] })?.data ?? [],
    meta:
      (payload as { meta?: ListMeta })?.meta ?? { pageSize: 0, nextCursor: null, hasMore: false, total: 0 },
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

/**
 * Thrown by `useReauth().run` when the user dismisses the identity prompt.
 * Not an error condition — `errorMessage` maps it to an empty string so the
 * existing `{error ? <Alert/> : null}` call sites silently show nothing.
 */
export class ReauthCancelledError extends Error {
  constructor() {
    super('');
    this.name = 'ReauthCancelledError';
  }
}

/** Machine-readable error code, for callers that must branch on it. */
export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

export function errorMessage(
  error: unknown,
  fallback: string = localText('Something went wrong. Please try again.'),
): string {
  if (error instanceof ReauthCancelledError) return '';
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
