import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'company_admin_session';

/**
 * Plaintext HTTP is upgraded before anything else looks at the request.
 *
 * In a correct deployment this never fires — the edge answers `:80` with a
 * redirect of its own and only ever forwards `https`. It is here because the
 * failure mode of getting that wrong is silent: the app would keep rendering,
 * and every session cookie and form post would cross the wire in the clear with
 * nothing to say so.
 *
 * **`x-forwarded-proto` is the only signal**, and its *absence* is treated as
 * "no opinion" rather than as http. A proxy that does not set it cannot be
 * distinguished from one that terminated TLS silently, and assuming the worst
 * there is precisely how a redirect loop starts.
 *
 * **307, not 308**, for the same reason. A permanent redirect is cached, so a
 * proxy that mislabels its own https traffic would pin an infinite loop into
 * every visitor's browser and fixing the proxy would not un-pin it. Nothing is
 * lost by making it temporary: the browser is meant to learn the upgrade from
 * `Strict-Transport-Security` (see `next.config.ts`), which is the stronger
 * promise anyway — it rewrites the request before it is sent, rather than after
 * it has already been sent in the clear once.
 */
const FORWARDED_HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i;

function httpsRedirect(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;

  const forwarded = request.headers.get('x-forwarded-proto');
  if (!forwarded) return null;
  if (forwarded.split(',')[0]!.trim().toLowerCase() === 'https') return null;

  // `Host` is attacker-supplied and is about to be built into a `Location`, so
  // anything that is not a plain `hostname[:port]` is left alone rather than
  // redirected — that is the difference between a redirector and an open one.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host || !FORWARDED_HOST_RE.test(host)) return null;

  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(`https://${host.replace(/:80$/, '')}${pathname}${search}`, 307);
}

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

  // Transport first: bouncing an http request to /sign-in would only move it to
  // another http URL, and the sign-in page is the one that takes a password.
  const upgrade = httpsRedirect(request);
  if (upgrade) return upgrade;

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
