import { z } from 'zod';
import { isProduction } from '../config/index';

/**
 * HTTPS-only URL validation, for every address a store owner can type in.
 *
 * **`z.string().url()` is not a scheme check.** Zod builds on `new URL()`, which
 * parses far more than the web addresses the name suggests — every one of these
 * passes it:
 *
 *   javascript:alert(document.cookie)   data:text/html;base64,PHNjcmlwdD4=
 *   vbscript:msgbox(1)                  file:///etc/passwd
 *
 * The first two are the whole of stored XSS. A banner's `linkUrl`, a category's
 * `imageUrl` and a product's `videoUrl` are owner-authored and then rendered by
 * the storefront as an `href` or a `src`; a `javascript:` value stored in any of
 * them is script the shop serves to its own customers under its own origin, and
 * a `data:text/html` one is a whole page of it. The storefront's own parser
 * (`sections/parse.ts`) refuses them at render, and `lib/sanitise.ts` refuses
 * them inside CMS bodies — this is the same rule applied at the write boundary,
 * so the value never reaches the column in the first place and every other
 * reader of that column inherits the guarantee.
 *
 * `http:` is refused too, which is the narrower point. The platform is served
 * over TLS end to end; an `http://` image in a page delivered over `https://` is
 * mixed content, which the browser blocks outright (or, for a link, silently
 * downgrades the visitor onto a connection anybody on the path can read and
 * rewrite). A CSP `upgrade-insecure-requests` covers the honest case, but it is
 * a rendering-time patch over a value that should never have been stored.
 *
 * Loopback is allowed outside production and nowhere else: local development
 * serves the panel and the API over plain http on `localhost`, and there is no
 * network for anyone to sit on. `config` forces this off in production the same
 * way it forces `DEV_STORE_SLUG` off.
 */

/** Hostnames with no network between the two ends. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) || host.endsWith('.localhost');
}

export interface SecureUrlOptions {
  /**
   * Permit `http://localhost`. Defaults to "only outside production", which is
   * what every caller wants; the flag exists for the config validator, which
   * runs before `isProduction` is meaningful to it.
   */
  allowLoopback?: boolean;
}

/**
 * True only for an `https:` address — or a loopback `http:` one outside
 * production.
 *
 * Deliberately answers false rather than throwing for anything unparseable, so
 * a caller can use it as a predicate without a try/catch of its own.
 */
export function isSecureUrl(value: string, options: SecureUrlOptions = {}): boolean {
  const allowLoopback = options.allowLoopback ?? !isProduction;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }

  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && allowLoopback && isLoopbackHostname(url.hostname)) return true;
  return false;
}

/**
 * `https://…` — the validator to reach for instead of `z.string().url()`.
 *
 * Trimmed and length-capped before the scheme is read, because a 2 MB string is
 * not worth parsing to find out it was never a URL.
 */
export function httpsUrl(max = 2000) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => isSecureUrl(value), {
      message: 'Use a full https:// web address.',
    });
}

/**
 * The same thing for a field a form clears by sending `""`.
 *
 * An empty string becomes `null` *before* validation, so "remove the picture" is
 * expressible without a second endpoint — the reason the categories module grew
 * its own copy of this preprocessing, which now lives here.
 */
export function httpsUrlNullable(max = 2000) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    httpsUrl(max).nullable(),
  );
}

/**
 * A destination the storefront may render as a link: an https address, or an
 * **internal path** such as `/sale`.
 *
 * `//evil.com` is refused explicitly — a protocol-relative URL starts with a
 * slash and is not a path at all, it is a link off-site wearing one's clothes.
 */
export function linkTarget(max = 2000) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z
      .string()
      .trim()
      .max(max)
      .refine(
        (value) => (value.startsWith('/') ? !value.startsWith('//') : isSecureUrl(value)),
        { message: 'Use an https:// address or a path beginning with /.' },
      )
      .nullable(),
  );
}
