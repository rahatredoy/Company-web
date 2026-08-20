import 'server-only';
import { cookies, headers } from 'next/headers';
import { apiFetch, apiFetchListed, ApiError } from './api';
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

/**
 * A list, read a batch at a time.
 *
 * `meta` carries `nextCursor`/`hasMore` and, on an uncursored read only, `total`.
 * Every screen in the panel scrolls rather than pages, so this is what a list
 * page calls for its first batch; the browser asks for the rest by cursor.
 */
export async function serverGetListed<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const call = await storeCall();
  return apiFetchListed<T>(path, {
    method: 'GET',
    query,
    cookieHeader: await cookieHeader(),
    baseUrl: call.baseUrl,
    headers: call.headers,
  });
}

/**
 * Every row of a list, not a page of them — for the screens that derive a tree, a
 * tally or a `<select>` from the whole set.
 *
 * Pages by number rather than by cursor deliberately: both envelopes still honour
 * `page` as an offset, so this reads the same either way and does not have to know
 * which one an endpoint has been moved to. A short batch is the end of the list.
 * `maxBatches` is the backstop — a store past it has outgrown the assumption that
 * this set is small, and truncating quietly would be worse than the cap.
 */
export async function serverGetAll<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  { pageSize = 100, maxBatches = 10 }: { pageSize?: number; maxBatches?: number } = {},
): Promise<T[]> {
  const out: T[] = [];

  for (let page = 1; page <= maxBatches; page += 1) {
    const batch = await serverGetListed<T>(path, { ...query, page, pageSize });
    out.push(...batch.data);
    if (batch.data.length < pageSize) break;
  }

  return out;
}

/** Returns null instead of throwing when the caller is simply not signed in. */
export async function serverGetOptional<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T | null> {
  try {
    return await serverGet<T>(path, query);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return null;
    throw error;
  }
}
