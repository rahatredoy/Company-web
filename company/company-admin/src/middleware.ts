import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'company_admin_session';

/**
 * Cheap routing guard only — it checks that a full session cookie exists so
 * signed-out visitors are not shown an empty shell. Real authorisation happens
 * in the API on every request; the cookie is HttpOnly and unreadable here.
 *
 * It deliberately only ever redirects *toward* `/sign-in`. The "you are already
 * signed in, go away" decision lives in the sign-in page, which can ask the API
 * what the session actually is — middleware cannot, and guessing from cookie
 * presence is what produced the old sign-in ↔ dashboard redirect loop.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/sign-in') return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg|api).*)'],
};
