import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CUSTOMER_SESSION_COOKIE } from '@/lib/api/account';
import { COOKIE_OPTIONS, forwardToApi } from '@/lib/auth-proxy';
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

/*
 * The number is passed through as typed. Normalising it to E.164 is the API's
 * job and has to stay there: the shape that ends up in the database is the one
 * a later sign-in must reproduce exactly, and two normalisers — one here, one
 * there — is two chances for them to drift and for a customer to be locked out
 * of their own account by a spelling.
 */
const phoneRequestSchema = z.object({ phone: z.string().trim().min(6).max(32) });

const phoneVerifySchema = z.object({
  phone: z.string().trim().min(6).max(32),
  code: z.string().trim().min(4).max(8),
});

const phoneRegisterSchema = z.object({
  ticket: z.string().trim().min(20).max(200),
  fullName: z.string().trim().min(2).max(120),
  acceptsTerms: z.literal(true),
});

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

const ACTIONS = new Set([
  'login',
  'register',
  'logout',
  'forgot-password',
  'reset-password',
  'phone-request',
  'phone-verify',
  'phone-register',
]);

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

    await forwardToApi('/api/v1/storefront/auth/logout', {}, 204).catch(() => null);

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

    await forwardToApi('/api/v1/storefront/auth/forgot-password', parsed.data, 204).catch(() => null);

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

    return forwardToApi('/api/v1/storefront/auth/register', parsed.data, 201);
  }

  if (action === 'phone-request') {
    const parsed = phoneRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter your mobile number.' }, { status: 400 });
    }

    return forwardToApi('/api/v1/storefront/auth/phone/request', parsed.data, 200);
  }

  if (action === 'phone-verify') {
    const parsed = phoneVerifySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Enter the code we sent you.' }, { status: 400 });
    }

    return forwardToApi('/api/v1/storefront/auth/phone/verify', parsed.data, 200);
  }

  if (action === 'phone-register') {
    const parsed = phoneRegisterSchema.safeParse(payload);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!key || details[key]) continue;
        details[key] =
          key === 'acceptsTerms' ? 'Please accept the terms to continue.' : 'Please check this field.';
      }
      return NextResponse.json({ error: 'Some details need your attention.', details }, { status: 422 });
    }

    return forwardToApi('/api/v1/storefront/auth/phone/register', parsed.data, 200);
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your email address and password.' }, { status: 400 });
  }

  return forwardToApi('/api/v1/storefront/auth/login', parsed.data, 200);
}
