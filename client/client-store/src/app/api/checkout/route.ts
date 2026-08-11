import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMockData } from '@/config';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Order placement.
 *
 * The browser sends what it *wants* to buy — product and variant ids, and
 * quantities. It does **not** send prices. Accepting a total from the client is
 * the single worst mistake a checkout can make, and the shape of this payload
 * is what makes it impossible: there is no field to put a price in.
 *
 * Live, the API re-reads every price, re-checks every stock level, re-applies
 * the coupon under its own rules and returns the authoritative order. The mock
 * branch does the same thing in miniature so the UI is built against the real
 * contract rather than a friendlier one.
 */

const schema = z.object({
  email: z.string().trim().email(),
  phone: z.string().trim().min(6).max(32),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        variantId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  shippingAddress: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(32),
    addressLine1: z.string().trim().min(3).max(200),
    addressLine2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().max(80).nullable().optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().min(2).max(60),
  }),
  shippingMethodId: z.string().min(1).max(40),
  paymentProvider: z.string().min(1).max(40),
  couponCode: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(`checkout:${clientIp(request)}`, 8, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please check your details and try again.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Field-level messages so the form can point at what is wrong, without
    // echoing Zod's internal wording at a customer.
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && !details[key]) details[key] = 'Please check this field.';
    }
    return NextResponse.json(
      { error: 'Some details need your attention.', details },
      { status: 422 },
    );
  }

  if (isMockData) {
    const { mockPlaceOrder } = await import('@/lib/api/mock/orders');
    const order = await mockPlaceOrder(parsed.data);
    return NextResponse.json({ data: order }, { status: 201 });
  }

  const { apiFetch, ApiError } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const order = await apiFetch<{ orderNumber: string; paymentRedirectUrl: string | null }>(
      '/api/v1/storefront/checkout',
      {
        method: 'POST',
        body: parsed.data,
        ...(await storeCall()),
        cookieHeader: await cookieHeader(),
      },
    );
    return NextResponse.json({ data: order }, { status: 201 });
  } catch (error) {
    // The API's messages are already customer-safe; anything else is generic.
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status || 502 },
      );
    }
    console.error('[storefront] checkout failed', error);
    return NextResponse.json({ error: 'We could not place your order.' }, { status: 502 });
  }
}
