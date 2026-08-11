import 'server-only';
import { headers } from 'next/headers';
import { publicConfig } from '@/config';
import { apiBaseForHost, slugFromHost } from './host';

/**
 * Which store a request belongs to is decided by the hostname — never by a
 * query parameter, a route segment, or anything else a visitor can type.
 *
 * The Commerce API re-derives the store from its own request and does not trust
 * what this app sends, so a disagreement here is a bug, not a way in.
 *
 * The hostname parsing itself lives in `./host`, without `server-only`, because
 * the browser has to answer the same question about `window.location`.
 */
export { apiBaseForHost, isValidStoreSlug, slugFromHost } from './host';

export interface RequestHost {
  /** The hostname the visitor actually reached, including any port. */
  host: string | null;
  /** Set when the store was reached on a platform subdomain. */
  slug: string | null;
  /** True when the hostname is a connected custom domain. */
  isCustomDomain: boolean;
  protocol: 'http' | 'https';
}

export async function requestHost(): Promise<RequestHost> {
  const incoming = await headers();
  const host = incoming.get('x-forwarded-host') ?? incoming.get('host');
  const slug = slugFromHost(host, publicConfig.platformRootDomain);

  const forwardedProto = incoming.get('x-forwarded-proto');
  const protocol = forwardedProto === 'http' ? 'http' : forwardedProto === 'https' ? 'https' : undefined;

  const hostname = (host ?? '').split(':')[0]!.toLowerCase();
  const isLocal = hostname === 'localhost' || hostname.endsWith('.localhost') || !hostname.includes('.');

  return {
    host,
    slug,
    isCustomDomain: !slug && !isLocal && hostname.length > 0,
    protocol: protocol ?? (isLocal ? 'http' : 'https'),
  };
}

/**
 * Everything an outgoing API call needs to reach *this visitor's* store, in one
 * value: which origin to call, and — in development only — the slug header.
 *
 * A server component cannot set a `Host` header on an outgoing fetch (`fetch`
 * drops it), so it cannot name the store the way a browser does. Instead it
 * calls the API at the address that already names it.
 *
 * The two travel together on purpose. They used to be separate, and only the
 * header had a helper — so every call site named the store correctly in
 * development and, in production, sent its request to whichever single store the
 * one configured API URL happened to point at. Spread this into the options of
 * every server-side `apiFetch` and a new call site cannot get half of it.
 *
 * `X-Store-Slug` is only ever populated in development, where `*.localhost` does
 * not resolve; in production the hostname reaches the API intact and the API's
 * own hostname resolution is the only thing deciding the tenant.
 */
export async function storeCall(): Promise<{ baseUrl: string; storeSlug: string | undefined }> {
  const { host, slug } = await requestHost();
  return {
    baseUrl: apiBaseForHost(host),
    storeSlug: publicConfig.devStoreSlug ? (slug ?? publicConfig.devStoreSlug) : undefined,
  };
}

/** Forwards the visitor's cookies to the API so it sees the session it issued. */
export async function cookieHeader(): Promise<string> {
  const incoming = await headers();
  return incoming.get('cookie') ?? '';
}
