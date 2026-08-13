import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMockCommerce } from '@/config';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Return request submission.
 *
 * Eligibility — whether the order is returnable, whether the window is open,
 * whether these quantities were actually bought — is re-checked by the API. The
 * wizard's own checks exist to give a fast answer, not to be the answer.
 */

const schema = z.object({
  items: z
    .array(z.object({ lineIndex: z.number().int().min(0).max(99), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  reason: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).nullable().optional(),
  resolution: z.enum(['refund', 'exchange', 'replacement']),
  evidenceCount: z.number().int().min(0).max(4).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  const limit = rateLimit(`return:${clientIp(request)}`, 5, 300_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const { orderNumber } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please check your request and try again.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check your request and try again.' }, { status: 422 });
  }

  if (isMockCommerce) {
    const { mockOrder } = await import('@/lib/api/mock/orders');
    const order = await mockOrder(orderNumber);

    if (!order || !order.canRequestReturn) {
      return NextResponse.json({ error: 'This order cannot be returned.' }, { status: 409 });
    }

    return NextResponse.json({ data: { returnNumber: `RET-${Date.now() % 100000}` } }, { status: 201 });
  }

  const { apiFetch, ApiError } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const data = await apiFetch<{ returnNumber: string }>(
      `/api/v1/storefront/account/orders/${encodeURIComponent(orderNumber)}/returns`,
      {
        method: 'POST',
        body: parsed.data,
        ...(await storeCall()),
        cookieHeader: await cookieHeader(),
      },
    );
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status || 502 });
    }
    return NextResponse.json({ error: 'We could not submit your return request.' }, { status: 502 });
  }
}
