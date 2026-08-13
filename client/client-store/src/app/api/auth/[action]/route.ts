import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMockCommerce } from '@/config';
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_MAX_AGE } from '@/lib/api/account';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Customer authentication: login, register, logout, password reset.
 *
 * Three properties this deliberately holds:
 *
 * 1. **The session cookie is set here, server-side, `httpOnly`.** A token
 *    handed to JavaScript is a token any injected script can read.
 * 2. **Failures are indistinguishable.** A wrong password and an address with
 *    no account produce the same response; so do a reset request for a real
 *    address and an unknown one. Otherwise this endpoint answers "does this
 *    person shop here?" for anyone with a word list.
 * 3. **Rate limited per address.** Not a substitute for the API's own limiting —
 *    which sees every instance and holds the lockout state — but it keeps a
 *    single machine from being used as a battering ram.
 */

const isProduction = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: isProduction,
};

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).optional(),
  password: z.string().min(8).max(200),
  acceptsTerms: z.literal(true),
});

const emailSchema = z.object({ email: z.string().trim().email().max(254) });

/**
 * The reset form posts a token and a new password.
 *
 * It also posts an `email` field it does not have, to satisfy the schema this
 * route used to share with `forgot-password`. That is ignored here — the token
 * is what identifies the account, and an email alongside it would only be
 * something to disagree with.
 */
const resetSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8).max(200),
});

const ACTIONS = new Set(['login', 'register', 'logout', 'forgot-password', 'reset-password']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await params;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'logout') {
    /*
     * The API is told as well as the cookie being cleared. Clearing the cookie
     * alone leaves a live session row behind — a token that was captured before
     * sign-out would keep working until it expired, which is the one moment a
     * customer is most likely to be on a shared machine.
     */
    if (!isMockCommerce) {
      await forwardToApi('/api/v1/storefront/auth/logout', {}, 204).catch(() => null);
    }

    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(CUSTOMER_SESSION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }

  const limit = rateLimit(`auth:${action}:${clientIp(request)}`, action === 'login' ? 10 : 5, 300_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please check your details and try again.' }, { status: 400 });
  }

  // Password reset never reveals whether the address is registered, so both of
  // these answer 204 whatever the API found.
  if (action === 'forgot-password') {
    const parsed = emailSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    if (!isMockCommerce) {
      await forwardToApi('/api/v1/storefront/auth/forgot-password', parsed.data, 204).catch(() => null);
    }
    return new NextResponse(null, { status: 204 });
  }

  if (action === 'reset-password') {
    const parsed = resetSchema.safeParse(payload);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (key && !details[key]) {
          details[key] = key === 'password' ? 'Use at least 8 characters.' : 'Please check this field.';
        }
      }
      return NextResponse.json({ error: 'Please check your details.', details }, { status: 422 });
    }

    if (isMockCommerce) return new NextResponse(null, { status: 204 });

    return forwardToApi('/api/v1/storefront/auth/reset-password', parsed.data, 204);
  }

  if (action === 'register') {
    const parsed = registerSchema.safeParse(payload);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!key || details[key]) continue;
        details[key] =
          key === 'password'
            ? 'Use at least 8 characters.'
            : key === 'acceptsTerms'
              ? 'Please accept the terms to continue.'
              : 'Please check this field.';
      }
      return NextResponse.json({ error: 'Some details need your attention.', details }, { status: 422 });
    }

    if (isMockCommerce) {
      const { mockRegister } = await import('@/lib/api/mock/account');
      const result = await mockRegister(parsed.data);

      if ('error' in result) {
        return NextResponse.json(
          { error: 'That email address cannot be used.', details: { email: 'Try signing in instead.' } },
          { status: 409 },
        );
      }

      const response = NextResponse.json({ data: { customer: result.customer } }, { status: 201 });
      response.cookies.set(CUSTOMER_SESSION_COOKIE, result.token, {
        ...COOKIE_OPTIONS,
        maxAge: CUSTOMER_SESSION_MAX_AGE,
      });
      return response;
    }

    return forwardToApi('/api/v1/storefront/auth/register', parsed.data, 201);
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your email address and password.' }, { status: 400 });
  }

  if (isMockCommerce) {
    const { mockLogin } = await import('@/lib/api/mock/account');
    const result = await mockLogin(parsed.data.email, parsed.data.password);

    if (!result) {
      // One message for both failure modes, on purpose.
      return NextResponse.json({ error: 'Those details do not match an account.' }, { status: 401 });
    }

    const response = NextResponse.json({ data: { customer: result.customer } });
    response.cookies.set(CUSTOMER_SESSION_COOKIE, result.token, {
      ...COOKIE_OPTIONS,
      maxAge: CUSTOMER_SESSION_MAX_AGE,
    });
    return response;
  }

  return forwardToApi('/api/v1/storefront/auth/login', parsed.data, 200);
}

/**
 * Whatever the Commerce API answered with, before this route has decided which
 * half of it to use. Both shapes are the documented envelope — `{ data }` on
 * success, `{ code, message, details }` on failure — but the body arrives as
 * text and may be neither, so every field is optional.
 */
type UpstreamPayload = {
  data?: unknown;
  message?: string;
  details?: unknown;
} | null;

/**
 * Passes the request to the Commerce API and re-issues whatever session cookie
 * it sets. The API is the authority on credentials; this route is a proxy that
 * keeps the token out of JavaScript's reach.
 *
 * It calls `fetch` directly rather than going through `lib/api/client`, and that
 * is the whole point of the function. `apiFetch` returns the parsed body and
 * drops the `Response` — so the `Set-Cookie` the API sends on a successful sign
 * in was being thrown away here. The symptom was not an error: login answered
 * `200`, the browser stored no session, `getCustomer()` came back null, and
 * `/account` bounced straight back to `/login`.
 */
async function forwardToApi(path: string, body: unknown, okStatus: number): Promise<NextResponse> {
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
    return NextResponse.json({ error: 'We could not reach the store. Please try again.' }, { status: 502 });
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
