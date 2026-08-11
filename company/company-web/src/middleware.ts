import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'company_client_session';

const PROTECTED_PREFIXES = ['/dashboard'];

/**
 * Cheap routing guard only — it checks that a session cookie exists so signed
 * out visitors are not shown an empty shell. Real authorisation happens in the
 * API on every request; the cookie is HttpOnly and cannot be read here.
 *
 * It deliberately does *not* send a visitor who has that cookie away from
 * /sign-in. The cookie only proves a session was issued at some point — it can
 * be stale, expired or already revoked — so bouncing on it turned "Sign in"
 * into a jump straight to the dashboard, and left anyone holding a dead cookie
 * ping-ponging between /sign-in and /dashboard with no way to reach sign-in,
 * register or the password reset. Signing in is always offered; the sign-in
 * page itself shows a shortcut to the dashboard once the API confirms the
 * session is real.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !request.cookies.has(SESSION_COOKIE)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
