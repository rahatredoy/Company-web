import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Return request submission.
 *
 * Eligibility — whether the order is returnable, whether the window is open,
 * whether these quantities were actually bought — is re-checked by the API. The
 * wizard's own checks exist to give a fast answer, not to be the answer.
 *
 * The wizard posts a form: the request as JSON in `payload`, and up to two
 * photos as `photos`. The form is rebuilt rather than piped through, so only
 * the fields named here ever reach the API.
 */

const MAX_RETURN_PHOTOS = 2;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const schema = z.object({
  items: z
    .array(z.object({ lineIndex: z.number().int().min(0).max(99), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  reason: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).nullable().optional(),
  resolution: z.enum(['refund', 'exchange', 'replacement']),
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Please check your request and try again.' }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get('payload') ?? ''));
  } catch {
    return NextResponse.json({ error: 'Please check your request and try again.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check your request and try again.' }, { status: 422 });
  }

  const photos = form.getAll('photos').filter((entry): entry is File => entry instanceof File);
  if (photos.length > MAX_RETURN_PHOTOS) {
    return NextResponse.json({ error: `Attach at most ${MAX_RETURN_PHOTOS} photos.` }, { status: 422 });
  }
  if (photos.some((photo) => !PHOTO_TYPES.has(photo.type))) {
    return NextResponse.json({ error: 'Photos must be JPEG, PNG or WebP.' }, { status: 415 });
  }
  if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES)) {
    return NextResponse.json({ error: 'Each photo must be under 5MB.' }, { status: 413 });
  }

  const outgoing = new FormData();
  outgoing.set('payload', JSON.stringify(parsed.data));
  for (const photo of photos) outgoing.append('photos', photo, photo.name);

  const { apiFetch, ApiError } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const data = await apiFetch<{ returnNumber: string }>(
      `/api/v1/storefront/account/orders/${encodeURIComponent(orderNumber)}/returns`,
      {
        method: 'POST',
        body: outgoing,
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
