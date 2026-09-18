import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config/index';
import { AppError, ERROR_CODES } from '../lib/errors';
import { slugFromHost } from '../lib/utils';
import {
  checkStoreAvailability,
  fetchTenantByDomain,
  fetchTenantBySlug,
  hostsForSurface,
  type TenantRecord,
} from '../lib/company-client';
import { surfaceOf } from '../lib/urls';
import { tenantDb, type TenantDb } from '../db/tenant-manager';

export interface StoreContext {
  slug: string;
  tenantRef: string;
  storeName: string;
  currency: string;
  language: string;
  timezone: string;
  status: TenantRecord['status'];
  storeStatus: TenantRecord['storeStatus'];
  entitlements: TenantRecord['entitlements'];
  trial: TenantRecord['trial'];
  domains: TenantRecord['domains'];
  /** Hostname canonical URLs must use; null means the platform subdomain. */
  primaryDomain: TenantRecord['primaryDomain'];
  db: TenantDb;
}

/** Routes that are deliberately tenant-free. */
const EXEMPT_PREFIXES = ['/health', '/api/v1/webhooks', '/api/v1/oauth'];

/**
 * Derives the store slug from trusted signals only.
 *
 * The hostname is the authority: it is what DNS and the reverse proxy agree on,
 * and a browser cannot forge it for a cross-origin request. A slug in a query
 * string or body is never consulted — that would let any signed-in store admin
 * read another store's data by editing a URL.
 *
 * `X-Store-Slug` exists solely so the panel works on `localhost` without
 * wildcard DNS, and is accepted only when `DEV_STORE_SLUG` is configured, which
 * `config` forces to `undefined` in production.
 */
export function resolveSlug(request: FastifyRequest): string | null {
  const fromHost = slugFromHost(request.headers.host, config.urls.platformRootDomain);
  if (fromHost) return fromHost;

  if (!isProduction && config.devStoreSlug) {
    const header = request.headers['x-store-slug'];
    const candidate = Array.isArray(header) ? header[0] : header;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().toLowerCase();

    // The bare fallback applies only to a hostname that carries no store
    // identity at all — loopback, which is the case it exists for. A real
    // hostname is a connected custom domain and has to be resolved as one, or
    // this fallback would answer for every domain on the internet and custom
    // domain routing could never be exercised outside production.
    if (isLocalHostname(request.headers.host)) return config.devStoreSlug;
  }

  return null;
}

function isLocalHostname(host: string | undefined): boolean {
  const hostname = (host ?? '').split(':')[0]!.toLowerCase();
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return true;
  return !hostname.includes('.');
}

/**
 * Finds the store for a request, by platform subdomain or by connected custom
 * domain.
 *
 * `abcfashion.com` carries no slug, so the company platform's verified-domain
 * table is the only authority for it. An unverified or disabled domain resolves
 * to nothing, which is what stops a hostname merely *pointed* at our IP from
 * serving somebody else's store.
 *
 * A custom domain is also connected for one surface — a storefront address or an
 * admin panel address, chosen when it was added — and it only answers for that
 * one. `admin.abcfashion.com` resolving the commerce routes, or `abcfashion.com`
 * resolving the admin routes, would make the distinction the owner drew when
 * they connected it mean nothing. Platform hostnames are exempt because
 * `api.<slug>.<root>` deliberately serves both; there the surfaces are told
 * apart by their own origins in `plugins/security.ts`.
 */
async function resolveTenant(request: FastifyRequest): Promise<TenantRecord | null> {
  const slug = resolveSlug(request);
  if (slug) return fetchTenantBySlug(slug);

  const host = request.headers.host;
  if (!host) return null;

  const hostname = host.split(':')[0]!.toLowerCase();
  // Loopback and the platform root are never custom domains; skipping them keeps
  // a misconfigured local setup from querying the company API on every request.
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || !hostname.includes('.')) {
    return null;
  }

  const tenant = await fetchTenantByDomain(hostname);
  if (!tenant) return null;

  // Reported as "not connected to a store", not as "wrong surface": which other
  // addresses a store owns is not something an unauthenticated caller should be
  // able to map out one hostname at a time.
  return hostsForSurface(tenant, surfaceOf(request.url)).includes(hostname) ? tenant : null;
}

/**
 * Resolve → verify the store may trade → open its database. Every step must
 * pass before a single row is read, and a blocked store never gets a pool.
 */
export async function loadStore(request: FastifyRequest): Promise<StoreContext> {
  const tenant = await resolveTenant(request);
  if (!tenant) {
    throw new AppError(
      ERROR_CODES.STORE_NOT_FOUND,
      'This address is not connected to a store.',
      404,
    );
  }

  const availability = checkStoreAvailability(tenant);
  if (!availability.allowed) {
    throw new AppError(
      availability.code ?? ERROR_CODES.STORE_SUSPENDED,
      availability.message ?? 'This store is not available.',
      403,
    );
  }

  // First call for a tenant opens the pool and brings its schema up to date.
  // The shard comes from the control plane and nowhere else — see `tenant-shards`.
  const db = await tenantDb.get(tenant.tenantRef, tenant.slug, tenant.databaseShard);

  return {
    slug: tenant.slug,
    tenantRef: tenant.tenantRef,
    storeName: tenant.storeName,
    currency: tenant.currency,
    language: tenant.language,
    timezone: tenant.timezone,
    status: tenant.status,
    storeStatus: tenant.storeStatus,
    entitlements: tenant.entitlements,
    trial: tenant.trial,
    domains: tenant.domains ?? [],
    primaryDomain: tenant.primaryDomain ?? null,
    db,
  };
}

export default fp(async function tenantPlugin(app: FastifyInstance) {
  app.decorateRequest('store', undefined);

  app.addHook('onRequest', async (request) => {
    if (EXEMPT_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;
    if (request.method === 'OPTIONS') return;

    request.store = await loadStore(request);
    request.log.debug({ tenantRef: request.store.tenantRef, slug: request.store.slug }, 'store resolved');
  });
});

/**
 * Narrowing helper for handlers. The hook above guarantees `store` is present on
 * every non-exempt route, but the type stays optional so exempt routes are not
 * lied to.
 */
export function storeOf(request: FastifyRequest): StoreContext {
  if (!request.store) {
    throw new AppError(ERROR_CODES.STORE_NOT_FOUND, 'No store context for this request.', 404);
  }
  return request.store;
}
