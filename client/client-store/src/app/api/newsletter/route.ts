import { NextResponse } from 'next/server';
import { z } from 'zod';
import { subscribeNewsletter } from '@/lib/api/content';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Newsletter sign-up, POSTed to by `sections/newsletter-form.tsx`.
 *
 * The form has always pointed here; the handler is what was missing, which is
 * why subscribing has so far only ever produced the error state.
 *
 * Every outcome that is not a malformed request or a flood returns **204**.
 * A new subscriber, an existing one, and an upstream failure are indistinguish-
 * able to the caller on purpose: the first two must not be separable or the box
 * becomes an "is this address registered here?" oracle, and the third must not
 * invite a retry loop against an API that is already struggling.
 */

const schema = z.object({
  email: z.string().trim().min(3).max(254).email(),
});

const LIMIT = 5;
const WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(`newsletter:${clientIp(request)}`, LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  try {
    await subscribeNewsletter(parsed.data.email);
  } catch (error) {
    // Logged for us, invisible to the visitor — see the note above.
    console.error('[storefront] newsletter subscribe failed', error);
  }

  return new NextResponse(null, { status: 204 });
}
