import { NextResponse, type NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/auth-proxy';
import { safeRedirectPath } from '@/lib/utils';

/**
 * Where Google's callback sends the browser once it has finished with it.
 *
 * The callback itself lands on the Commerce API's own hostname — Google matches
 * redirect URIs exactly, so one is registered for the whole platform rather than
 * one per shop — and it cannot sign anybody in from there: a session cookie set
 * by a response served from the API's domain is not a cookie this shop's origin
 * will ever send back. So the callback parks the profile under a single-use code
 * and bounces the browser here, where the exchange happens on the shop's own
 * origin and the cookie lands where it belongs.
 *
 * The code is spent server-side and never reaches the page. It is in the query
 * string for exactly one hop, which is why it is single-use and lives two
 * minutes.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeRedirectPath(request.nextUrl.searchParams.get('next') ?? undefined, '/account');

  const failed = NextResponse.redirect(new URL('/login?error=google', request.nextUrl.origin));
  if (!code) return failed;

  const proxied = await forwardToApi('/api/v1/storefront/auth/google/exchange', { code }, 200);
  if (proxied.status !== 200) return failed;

  /*
   * A redirect rather than the proxy's JSON, carrying its cookie across. The
   * cookie is the only part of that response worth anything here — the customer
   * record it also returns is about to be read again by the page being
   * redirected to, from a session that now exists.
   */
  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
  for (const cookie of proxied.cookies.getAll()) response.cookies.set(cookie);

  return response;
}
