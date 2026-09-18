import { NextResponse, type NextRequest } from 'next/server';

/**
 * Plaintext HTTP is upgraded before anything else looks at the request.
 *
 * In a correct deployment this never fires — the edge answers `:80` with a
 * redirect of its own and only ever forwards `https`. It is here because the
 * failure mode of getting that wrong is silent: the storefront would keep
 * rendering, and every session cookie and checkout post would cross the wire in
 * the clear with nothing to say so.
 *
 * **`x-forwarded-proto` is the only signal**, and its *absence* is treated as
 * "no opinion" rather than as http. A proxy that does not set it cannot be
 * distinguished from one that terminated TLS silently, and assuming the worst
 * there is precisely how a redirect loop starts.
 *
 * **307, not 308.** A permanent redirect is cached, so a proxy that mislabels
 * its own https traffic would pin an infinite loop into every visitor's browser
 * and fixing the proxy would not un-pin it. Nothing is lost by making it
 * temporary: the browser is meant to learn the upgrade from
 * `Strict-Transport-Security` (see `next.config.ts`), which rewrites the request
 * before it is sent rather than after it has already gone out in the clear once.
 *
 * It lives here rather than in a `middleware.ts` of its own because **Next 16
 * allows one or the other, never both** — `proxy.ts` is this version's name for
 * the file, and a second one alongside it stops every route resolving.
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


const DESIGN_PREVIEW_COOKIE = 'sf_design';
const DESIGN_PREVIEW_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Turns a `?template=…&theme=…` link into a design preview.
 *
 * Two things happen here, and only these two:
 *
 * 1. The values are copied into request headers. A root layout cannot read a
 *    page's search params, but it can read headers — so this is how a shared
 *    preview link reaches the store-config loader on the very first render.
 * 2. The same values are written to a cookie, so the preview survives the next
 *    navigation instead of evaporating the moment the visitor clicks anything.
 *
 * Nothing is validated here. Proxy runs on every request, may be deployed to a
 * CDN edge, and must stay cheap and dependency-free — so it passes the strings
 * through and `lib/design/preview.ts` maps them onto the closed template and
 * theme sets, dropping anything that is not a real key. A crafted URL therefore
 * yields a valid design or none at all.
 *
 * A preview is one browser's cookie. It cannot change what any other visitor
 * sees; publishing a design for the whole store is an authorised write to the
 * Commerce API and does not go through here.
 */
export default function proxy(request: NextRequest) {
  // Transport first. A design preview is not worth deciding on a request that
  // is about to be sent somewhere else anyway.
  const upgrade = httpsRedirect(request);
  if (upgrade) return upgrade;

  const template = request.nextUrl.searchParams.get('template');
  const theme = request.nextUrl.searchParams.get('theme');

  if (!template && !theme) return NextResponse.next();

  const headers = new Headers(request.headers);
  if (template) headers.set('x-preview-template', template);
  if (theme) headers.set('x-preview-theme', theme);

  const response = NextResponse.next({ request: { headers } });

  // Length-capped before it is stored: the value arrives from a URL, and a
  // cookie is sent back on every subsequent request to this origin.
  response.cookies.set(
    DESIGN_PREVIEW_COOKIE,
    `${(template ?? '').slice(0, 40)}.${(theme ?? '').slice(0, 40)}`,
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: DESIGN_PREVIEW_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    },
  );

  return response;
}

export const config = {
  // Static assets and image optimisation never need this.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
