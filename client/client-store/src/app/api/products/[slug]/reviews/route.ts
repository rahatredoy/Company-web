import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Review submission.
 *
 * A route handler rather than a Server Action because the form is a client
 * island inside a dialog and wants a plain `fetch` it can show a spinner
 * against.
 *
 * Whether the reviewer actually bought the product is decided upstream from the
 * order history — never claimed by the browser. The response says "pending"
 * because that is what happens: reviews are moderated before they appear, and
 * showing one immediately would misrepresent the process.
 */

/**
 * No `title`: the form no longer asks for one, so nothing is accepted for it
 * either. Reviews written before that change keep the headline they were given
 * — the display side still renders one when it is there.
 */
const schema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(10).max(2000),
});

/**
 * The visitor's translator, for the error messages below — imported on demand,
 * like the rest of the data layer this handler reaches, and only on the paths
 * that have something to say.
 */
async function translator() {
  const { getT } = await import('@/lib/i18n/server');
  return getT();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const limit = rateLimit(`review:${clientIp(request)}`, 3, 60_000);
  if (!limit.ok) {
    const t = await translator();
    return NextResponse.json(
      { error: t('Too many submissions. Please try again shortly.') },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const { slug } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    const t = await translator();
    return NextResponse.json({ error: t('Please check your review and try again.') }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const t = await translator();
    return NextResponse.json({ error: t('Please check your review and try again.') }, { status: 400 });
  }

  const { apiFetch } = await import('@/lib/api/client');
  const { storeCall, cookieHeader } = await import('@/lib/tenant');

  try {
    const result = await apiFetch<{ status: 'pending' | 'published' }>(
      `/api/v1/storefront/products/${encodeURIComponent(slug)}/reviews`,
      {
        method: 'POST',
        body: parsed.data,
        ...(await storeCall()),
        // Visitor-specific: the API resolves the customer from their session.
        cookieHeader: await cookieHeader(),
      },
    );
    return NextResponse.json({ data: result }, { status: 202 });
  } catch (error) {
    console.error('[storefront] review submission failed', error);
    const t = await translator();
    return NextResponse.json({ error: t('We could not submit your review.') }, { status: 502 });
  }
}
