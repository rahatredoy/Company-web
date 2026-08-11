import { NextResponse, type NextRequest } from 'next/server';

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
