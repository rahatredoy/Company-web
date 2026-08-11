/**
 * One deployment serves every store, so which store a request belongs to is
 * decided by the hostname — never by a query string, a form field or anything
 * else a visitor can edit.
 *
 * This mirrors `client-api/src/lib/utils.ts#slugFromHost`. The API re-derives
 * the slug from its own request and does not trust what the panel sends, so a
 * disagreement here is a bug, not a vulnerability.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

export function isValidStoreSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes('--');
}

export function slugFromHost(host: string | undefined | null, rootDomain: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();

  if (hostname.endsWith(`.${rootDomain}`)) {
    const prefix = hostname.slice(0, -(rootDomain.length + 1));
    const parts = prefix.split('.');
    const candidate = parts.length >= 2 && parts[0] === 'admin' ? parts[1] : parts[parts.length - 1];
    return candidate && isValidStoreSlug(candidate) ? candidate : null;
  }

  if (hostname.endsWith('.localhost')) {
    const prefix = hostname.slice(0, -'.localhost'.length);
    const parts = prefix.split('.');
    const candidate = parts.length >= 2 && parts[0] === 'admin' ? parts[1] : parts[0];
    return candidate && isValidStoreSlug(candidate) ? candidate : null;
  }

  return null;
}
