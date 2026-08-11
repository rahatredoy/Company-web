import 'server-only';
import { cookies, headers } from 'next/headers';
import { apiFetch, apiFetchPaginated, ApiError } from './api';
import { apiBaseForHost, publicEnv } from './env';
import { slugFromHost } from './store-slug';

/**
 * Server-side API access. The browser session cookie is forwarded verbatim so
 * the API sees the same session it issued — nothing is re-signed here.
 */
async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** The hostname the visitor actually reached, through however many proxies. */
async function incomingHost(): Promise<string | null> {
  const incoming = await headers();
  return incoming.get('x-forwarded-host') ?? incoming.get('host');
}

/**
 * Which store this render belongs to, taken from the hostname the visitor
 * actually reached — never from a route param or a search param.
 *
 * Returns null on a connected custom domain, which carries no slug. That is not
 * a failure: the API resolves such a hostname through the platform's
 * verified-domain table, and this value is only used for building links and for
 * the development header.
 */
export async function currentStoreSlug(): Promise<string | null> {
  return slugFromHost(await incomingHost(), publicEnv.rootDomain) ?? publicEnv.devStoreSlug ?? null;
}

/**
 * A server component cannot set a `Host` header on an outgoing fetch — `fetch`
 * drops it — so it cannot name the store the way a browser does. Instead it
 * calls the API *at the address that already names it*: `apiBaseForHost` turns
 * the incoming hostname into either the store's own API origin or, on a custom
 * domain, the visitor's own origin, where the edge proxy preserves the host.
 */
async function storeCall(): Promise<{ baseUrl: string; headers: Record<string, string> }> {
  const host = await incomingHost();
  const baseUrl = apiBaseForHost(host);

  if (!publicEnv.devStoreSlug) return { baseUrl, headers: {} };

  const slug = await currentStoreSlug();
  return { baseUrl, headers: slug ? { 'X-Store-Slug': slug } : {} };
}

export async function serverGet<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const call = await storeCall();
  return apiFetch<T>(path, {
    method: 'GET',
    query,
    cookieHeader: await cookieHeader(),
    baseUrl: call.baseUrl,
    headers: call.headers,
  });
}

export async function serverGetPaginated<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const call = await storeCall();
  return apiFetchPaginated<T>(path, {
    method: 'GET',
    query,
    cookieHeader: await cookieHeader(),
    baseUrl: call.baseUrl,
    headers: call.headers,
  });
}

/** Returns null instead of throwing when the caller is simply not signed in. */
export async function serverGetOptional<T>(path: string): Promise<T | null> {
  try {
    return await serverGet<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return null;
    throw error;
  }
}
