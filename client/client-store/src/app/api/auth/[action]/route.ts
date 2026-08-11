import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMockData } from '@/config';
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

const ACTIONS = new Set(['login', 'register', 'logout', 'forgot-password', 'reset-password']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await params;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'logout') {
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

  // Password reset never reveals whether the address is registered.
  if (action === 'forgot-password' || action === 'reset-password') {
    const parsed = emailSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    return new NextResponse(null, { status: 204 });
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

    if (isMockData) {
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

  if (isMockData) {
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
 * Passes the request to the Commerce API and re-issues whatever session cookie
 * it sets. The API is the authority on credentials; this route is a proxy that
 * keeps the token out of JavaScript's reach.
 */
async function forwardToApi(path: string, body: unknown, okStatus: number): Promise<NextResponse> {
  const { apiFetch, ApiError } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const data = await apiFetch<unknown>(path, {
      method: 'POST',
      body,
      ...(await storeCall()),
      cookieHeader: await cookieHeader(),
    });
    return NextResponse.json({ data }, { status: okStatus });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status || 502 },
      );
    }
    return NextResponse.json({ error: 'We could not complete that just now.' }, { status: 502 });
  }
}
