import { config } from '../config/index';

/**
 * Every customer-visible URL is derived from a pattern plus the store slug —
 * never from a request header. A `Host` a caller controls must never end up in
 * an email link.
 */
function fill(pattern: string, slug: string): string {
  return pattern.replace(/\{slug\}/g, slug).replace(/\/$/, '');
}

export function adminBaseUrl(slug: string): string {
  return fill(config.urls.adminUrlPattern, slug);
}

export function storeBaseUrl(slug: string): string {
  return fill(config.urls.storeUrlPattern, slug);
}

export function adminUrl(slug: string, path: string): string {
  return `${adminBaseUrl(slug)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function storeUrl(slug: string, path: string): string {
  return `${storeBaseUrl(slug)}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Which browser surface a request belongs to.
 *
 * The two are separated because they are not equally trusted. A storefront page
 * renders catalogue copy and CMS content that the store owner authored, and its
 * origin has no business calling the admin API even for its own store; the panel
 * is the highest-value surface on the platform and is the only one that should
 * be able to.
 */
export type Surface = 'admin' | 'storefront';

/** Admin routes are the ones the store admin session guards. */
export function surfaceOf(url: string): Surface {
  return url.startsWith('/api/v1/admin') ? 'admin' : 'storefront';
}

function originOf(base: string): string | null {
  try {
    return new URL(base).origin;
  } catch {
    // A malformed pattern is a config error; ignore it rather than crash CORS.
    return null;
  }
}

/**
 * Origins the browser is allowed to call this API from, for one store and one
 * surface.
 *
 * Because custom domains are supported the allow-list cannot be static, so an
 * incoming Origin is reduced to a slug and then rebuilt from these patterns and
 * compared exactly — `evil-abc-fashion.localhost` rebuilds to something else and
 * is refused.
 */
export function allowedOriginsFor(slug: string, surface: Surface): string[] {
  const base = surface === 'admin' ? adminBaseUrl(slug) : storeBaseUrl(slug);
  const origin = originOf(base);
  return origin ? [origin] : [];
}
