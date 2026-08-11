import 'server-only';
import { cookies } from 'next/headers';
import { apiFetch, apiFetchPaginated, ApiError } from './api';

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

export async function serverGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  return apiFetch<T>(path, { method: 'GET', query, cookieHeader: await cookieHeader() });
}

export async function serverGetPaginated<T>(path: string, query?: Record<string, string | number | undefined>) {
  return apiFetchPaginated<T>(path, { method: 'GET', query, cookieHeader: await cookieHeader() });
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
