import { NextResponse } from 'next/server';
import { z } from 'zod';
import { submitContactMessage } from '@/lib/api/content';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Contact form submission.
 *
 * Rate-limited harder than the newsletter: this one produces a message a human
 * has to read, so a flood costs staff time rather than a database row.
 */

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).optional(),
  subject: z.string().trim().min(2).max(160),
  message: z.string().trim().min(10).max(4000),
});

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(`contact:${clientIp(request)}`, 3, 300_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many messages. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Please check your message and try again.' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && !details[key]) {
        details[key] =
          issue.code === 'too_small' ? 'This is a little short.' : 'Please check this field.';
      }
    }
    return NextResponse.json({ error: 'Some details need your attention.', details }, { status: 422 });
  }

  try {
    await submitContactMessage(parsed.data);
  } catch (error) {
    console.error('[storefront] contact submission failed', error);
    return NextResponse.json({ error: 'We could not send your message.' }, { status: 502 });
  }

  return new NextResponse(null, { status: 204 });
}
