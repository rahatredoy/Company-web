import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMockCommerce } from '@/config';
import { clientIp, rateLimit } from '@/lib/rate-limit';

const schema = z.object({
  code: z.string().trim().min(1).max(40),
  subtotal: z.number().min(0).max(100_000_000),
});

/**
 * Checks a coupon against the store's own rules.
 *
 * The basket lives in `localStorage`, so the cart can only ever show an
 * estimate — but the **discount** must not be an estimate. This storefront used
 * to carry two hardcoded coupon tables that already disagreed with each other
 * about one code's minimum, which meant a figure shown in the basket and a
 * different one charged at the till. Both are gone; the number comes from the
 * same function checkout itself calls.
 *
 * Proxied through this route rather than called from the browser so the request
 * stays same-origin, exactly as checkout and reviews do.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(`coupon:${clientIp(request)}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Enter a code.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a code.' }, { status: 400 });

  if (isMockCommerce) {
    // No fixtures for this: a made-up discount is the exact failure the endpoint
    // exists to prevent, so the mock branch simply refuses every code.
    return NextResponse.json({
      data: { valid: false, reason: 'unknown', message: 'That code is not valid.' },
    });
  }

  const { apiFetch, ApiError } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const result = await apiFetch<unknown>('/api/v1/storefront/coupons/validate', {
      method: 'POST',
      body: parsed.data,
      ...(await storeCall()),
      cookieHeader: await cookieHeader(),
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status || 502 });
    }
    return NextResponse.json({ error: 'We could not check that code.' }, { status: 502 });
  }
}
