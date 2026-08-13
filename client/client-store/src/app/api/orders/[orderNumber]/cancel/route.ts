import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMockCommerce } from '@/config';

/**
 * Order cancellation.
 *
 * Whether an order *may* be cancelled is decided by the API from its current
 * state, not by this route and not by the button that called it. A shipped
 * order must be refused even if the browser thought it was still pending —
 * which it will, if the page was open while the warehouse packed it.
 */

const schema = z.object({
  reason: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  const { orderNumber } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please choose a reason.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please choose a reason.' }, { status: 400 });
  }

  if (isMockCommerce) {
    const { mockCancelOrder } = await import('@/lib/api/mock/orders');
    const cancelled = await mockCancelOrder(orderNumber);

    if (!cancelled) {
      return NextResponse.json(
        { error: 'This order can no longer be cancelled. Contact us and we will help.' },
        { status: 409 },
      );
    }

    return new NextResponse(null, { status: 204 });
  }

  const { apiFetch, ApiError } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    await apiFetch<unknown>(
      `/api/v1/storefront/account/orders/${encodeURIComponent(orderNumber)}/cancel`,
      {
        method: 'POST',
        body: parsed.data,
        ...(await storeCall()),
        cookieHeader: await cookieHeader(),
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status || 502 });
    }
    return NextResponse.json({ error: 'We could not cancel this order.' }, { status: 502 });
  }
}
