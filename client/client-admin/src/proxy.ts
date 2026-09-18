import { NextResponse, type NextRequest } from 'next/server';

/**
 * Plaintext HTTP is upgraded before the request reaches a page.
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
 *
 * The file is `proxy.ts` rather than `middleware.ts` because that is Next 16's
 * name for it. **The two must never coexist**: a `middleware.ts` beside a
 * `proxy.ts` stops every route in the app resolving, and it fails as a 404 on
 * every page rather than as an error naming the conflict.
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
 * Transport only.
 *
 * There is deliberately no auth guard here, unlike the two company apps. This
 * panel's session cookie is issued by `client-api` and scoped per store, and
 * which store a request belongs to is decided from the `Host` header by the API
 * — middleware would have to re-derive that to say anything useful, and a second
 * copy of the tenant rules is how the two quietly disagree. Every page already
 * reads the session through the API on the server, which is the check that
 * counts.
 */
export default function proxy(request: NextRequest): NextResponse {
  return httpsRedirect(request) ?? NextResponse.next();
}

export const config = {
  /*
   * Every document request, and nothing that is only ever a sub-resource of one.
   *
   * `_next/static` and `_next/image` are fetched with the scheme of the page
   * that asked for them, so a document that has been upgraded brings its assets
   * with it — and the CSP's `upgrade-insecure-requests` catches any that were
   * authored with an absolute http address.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)'],
};
