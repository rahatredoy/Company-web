import { NextResponse } from 'next/server';
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_MAX_AGE } from '@/lib/api/account';

/**
 * Passing a credential to the Commerce API and re-issuing whatever session it
 * hands back.
 *
 * Extracted from `app/api/auth/[action]/route.ts` once a second route needed it:
 * the Google flow finishes on a `GET` that has to end in a redirect, not on the
 * `POST` the sign-in forms use, and the one thing neither may get wrong is the
 * cookie. Two copies of that would be two chances to lose it.
 *
 * It calls `fetch` directly rather than going through `lib/api/client`, and that
 * is the whole point of the function. `apiFetch` returns the parsed body and
 * drops the `Response` — so the `Set-Cookie` the API sends on a successful sign
 * in was being thrown away. The symptom was not an error: login answered `200`,
 * the browser stored no session, `getCustomer()` came back null, and `/account`
 * bounced straight back to `/login`.
 */

const isProduction = process.env.NODE_ENV === 'production';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: isProduction,
};

/**
 * Whatever the Commerce API answered with, before the caller has decided which
 * half of it to use. Both shapes are the documented envelope — `{ data }` on
 * success, `{ code, message, details }` on failure — but the body arrives as
 * text and may be neither, so every field is optional.
 */
type UpstreamPayload = {
  data?: unknown;
  message?: string;
  details?: unknown;
} | null;

export async function forwardToApi(
  path: string,
  body: unknown,
  okStatus: number,
): Promise<NextResponse> {
  const { storeCall, cookieHeader } = await import('@/lib/tenant');
  const { baseUrl, storeSlug } = await storeCall();

  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' });
  const cookie = await cookieHeader();
  if (cookie) headers.set('cookie', cookie);
  if (storeSlug) headers.set('X-Store-Slug', storeSlug);

  let upstream: Response;
  try {
    upstream = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'We could not reach the store. Please try again.' },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let payload: UpstreamPayload = null;
  try {
    payload = text ? (JSON.parse(text) as UpstreamPayload) : null;
  } catch {
    payload = null;
  }

  if (!upstream.ok) {
    const { flattenDetails } = await import('@/lib/api/client');
    return NextResponse.json(
      {
        error: payload?.message ?? 'We could not complete that just now.',
        // Flattened to one message per field: the API reports every message it
        // has, and these forms each render one line under one input.
        details: flattenDetails(payload?.details),
      },
      { status: upstream.status || 502 },
    );
  }

  const response =
    okStatus === 204
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ data: payload?.data ?? payload }, { status: okStatus });

  /*
   * The API scopes its cookie to the store's own domain; re-issuing it from
   * here re-scopes it to this origin, which is what the storefront's own
   * `cookieHeader()` will read back on the next request.
   */
  for (const raw of upstream.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const index = (pair ?? '').indexOf('=');
    if (index <= 0) continue;

    const name = pair!.slice(0, index).trim();
    const value = pair!.slice(index + 1);

    if (name !== CUSTOMER_SESSION_COOKIE) continue;

    response.cookies.set(name, value, {
      ...COOKIE_OPTIONS,
      maxAge: value ? CUSTOMER_SESSION_MAX_AGE : 0,
    });
  }

  return response;
}
