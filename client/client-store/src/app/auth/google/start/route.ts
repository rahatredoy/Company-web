import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api/client';
import { storeCall } from '@/lib/tenant';
import { safeRedirectPath } from '@/lib/utils';

/**
 * The Google button's destination.
 *
 * A route handler rather than a link straight to the Commerce API, and that is
 * load-bearing: the API decides which store it is serving from the `Host` header
 * alone, and a browser sent directly to the API origin would arrive carrying the
 * API's hostname rather than the shop's. So the shop asks on the visitor's
 * behalf — `storeCall()` is what puts the right store on that request — and then
 * sends the browser to whatever Google URL comes back.
 *
 * The URL is not built here. It carries a `state` the API minted and stored, and
 * a client id the storefront deliberately does not hold: this app has no secrets
 * and no API credentials, and that stays true.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = safeRedirectPath(request.nextUrl.searchParams.get('next') ?? undefined, '/account');
  const failed = new URL('/login?error=google', request.nextUrl.origin);

  try {
    const { url } = await apiFetch<{ url: string }>('/api/v1/storefront/auth/google/start', {
      query: { next },
      ...(await storeCall()),
    });

    return NextResponse.redirect(url);
  } catch {
    // Google not configured, rate limited, or the API is down. All three are the
    // same thing to the shopper: the button did not work, use another way in.
    return NextResponse.redirect(failed);
  }
}
