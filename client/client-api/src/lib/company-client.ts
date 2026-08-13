import { config } from '../config/index';
import { AppError, ERROR_CODES, notFound } from './errors';
import { logger } from './logger';
import { redis } from './redis';

export interface TenantEntitlements {
  planCode: string;
  planName: string;
  supportLevel: 'email' | 'priority' | 'dedicated';
  productLimit: number | null;
  adminLimit: number | null;
  storageLimitMb: number | null;
  customDomainEnabled: boolean;
  customAdminDomainEnabled: boolean;
  analyticsEnabled: boolean;
  reportsEnabled: boolean;
}

export interface TenantDomain {
  domain: string;
  type: 'platform_subdomain' | 'storefront_custom' | 'admin_custom';
  isPrimary: boolean;
}

export interface TenantRecord {
  tenantRef: string;
  slug: string;
  storeName: string;
  status: 'pending' | 'provisioning' | 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';
  storeStatus: 'not_created' | 'creating' | 'ready' | 'failed' | 'suspended';
  currency: string;
  language: string;
  timezone: string;
  storefrontTemplate: string;
  /**
   * Which shard of the tenant cluster holds this store's database. An id only —
   * the connection details for it are this API's own configuration, so a
   * compromised control plane cannot redirect a store onto a server of its
   * choosing. `null` means a store provisioned before the cluster was sharded.
   */
  databaseShard: string | null;
  /** Every hostname this store may legitimately be reached on. */
  domains: TenantDomain[];
  /** The hostname canonical URLs must use, when a custom one is connected. */
  primaryDomain: string | null;
  entitlements: TenantEntitlements | null;
  subscriptionStatus: string | null;
  trial: { status: string; endsAt: string | null; daysRemaining: number } | null;
}

/**
 * Bumped to `v2` when `databaseShard` was added. A cached `v1` record has no
 * shard, which now reads as "the pre-sharding server" — so a store that had just
 * been moved would be served from the copy left behind. A new prefix retires
 * every old entry at once instead of waiting out the TTL.
 *
 * `company-api/src/lib/tenant-cache.ts` deletes by this same prefix; the two
 * must be changed together.
 */
const CACHE_PREFIX = 'tenant:v2:';

/**
 * Exported so the verification scripts, which poison this cache to exercise the
 * blocked-store paths, cannot drift onto a stale prefix when it is bumped —
 * which is exactly what happened when it went from `v1` to `v2`.
 */
export function tenantCacheKey(slug: string): string {
  return `${CACHE_PREFIX}${slug}`;
}
const NEGATIVE_TTL_SECONDS = 15;

async function callCompany<T>(path: string, init?: RequestInit): Promise<T | null> {
  const url = `${config.company.apiUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'x-internal-key': config.company.internalApiKey,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, path }, 'company control plane unreachable');
    throw new AppError(
      ERROR_CODES.TENANT_UNAVAILABLE,
      'The platform is temporarily unavailable. Please try again shortly.',
      503,
    );
  }

  if (response.status === 404) return null;

  if (response.status === 401) {
    // Misconfiguration, not a user error — make it loud in the logs.
    logger.fatal({ path }, 'INTERNAL_API_KEY rejected by the company API');
    throw new AppError(ERROR_CODES.TENANT_UNAVAILABLE, 'The platform is temporarily unavailable.', 503);
  }

  if (!response.ok) {
    logger.error({ status: response.status, path }, 'company control plane error');
    throw new AppError(ERROR_CODES.TENANT_UNAVAILABLE, 'The platform is temporarily unavailable.', 503);
  }

  const payload = (await response.json().catch(() => null)) as { data?: T } | null;
  return (payload?.data ?? null) as T | null;
}

/**
 * Resolves a store by slug through the company control plane, cached in Redis.
 *
 * The company API is the only authority on whether a store may trade — it is
 * rate limited globally, so every lookup goes through this cache. A miss is
 * cached briefly too, so a bad hostname cannot be used to hammer the company.
 */
export async function fetchTenantBySlug(slug: string): Promise<TenantRecord | null> {
  const key = `${CACHE_PREFIX}${slug}`;

  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    return cached === 'null' ? null : (JSON.parse(cached) as TenantRecord);
  }

  const record = await callCompany<TenantRecord>(`/api/v1/internal/tenants/by-slug/${encodeURIComponent(slug)}`);

  await redis
    .setex(
      key,
      record ? config.company.cacheTtlSeconds : NEGATIVE_TTL_SECONDS,
      record ? JSON.stringify(record) : 'null',
    )
    .catch(() => undefined);

  return record;
}

export async function fetchTenantByRef(tenantRef: string): Promise<TenantRecord | null> {
  return callCompany<TenantRecord>(`/api/v1/internal/tenants/${encodeURIComponent(tenantRef)}`);
}

/** One row per provisioned store, as `GET /internal/tenants` returns them. */
export interface TenantSummary {
  tenantRef: string;
  slug: string;
  storeName: string;
  status: TenantRecord['status'];
  storeStatus: TenantRecord['storeStatus'];
  databaseShard: string | null;
}

/**
 * Every provisioned store on the platform.
 *
 * For the operations that must visit all of them — pre-warming the schema after
 * a deploy, above all. Deliberately not cached: a sweep wants the list as it is
 * right now, and a stale entry here means a store silently missed.
 */
export async function fetchAllTenants(): Promise<TenantSummary[]> {
  return (await callCompany<TenantSummary[]>('/api/v1/internal/tenants')) ?? [];
}

const HOSTNAME_RE = /^[a-z0-9.-]+$/;

/**
 * Resolves a store reached on a connected custom domain, e.g. `abcfashion.com`.
 *
 * Such a hostname carries no slug, so the company platform's verified-domain
 * table is the only authority. Cached on the same terms as the slug lookup —
 * including a short negative cache, so an unknown hostname pointed at our IP
 * cannot be used to hammer the company API.
 */
export async function fetchTenantByDomain(host: string): Promise<TenantRecord | null> {
  const hostname = host.split(':')[0]!.trim().toLowerCase();
  if (!hostname || hostname.length > 253 || !HOSTNAME_RE.test(hostname)) return null;

  const key = `${CACHE_PREFIX}domain:${hostname}`;

  const cached = await redis.get(key).catch(() => null);
  if (cached) return cached === 'null' ? null : (JSON.parse(cached) as TenantRecord);

  const record = await callCompany<TenantRecord>(
    `/api/v1/internal/tenants/by-domain/${encodeURIComponent(hostname)}`,
  );

  await redis
    .setex(
      key,
      record ? config.company.cacheTtlSeconds : NEGATIVE_TTL_SECONDS,
      record ? JSON.stringify(record) : 'null',
    )
    .catch(() => undefined);

  return record;
}

/**
 * Hostnames a browser may reach one store's **storefront** on: the platform
 * subdomain it was provisioned with, plus any verified custom domain the owner
 * connected for it.
 */
export function storefrontHostsOf(tenant: TenantRecord): string[] {
  return tenant.domains
    .filter((entry) => entry.type !== 'admin_custom')
    .map((entry) => entry.domain.toLowerCase());
}

/**
 * Hostnames a browser may reach one store's **admin panel** on.
 *
 * Only `admin_custom` rows appear here. The panel's platform address
 * (`admin.<slug>.<root>`) is not a row in the domains table at all — it is
 * derived from `ADMIN_URL_PATTERN`, and `lib/urls.ts#allowedOriginsFor` rebuilds
 * it from the slug. This list is exactly the addresses that carry no slug and so
 * can only be resolved through the company platform's verified-domain table.
 */
export function adminHostsOf(tenant: TenantRecord): string[] {
  return tenant.domains
    .filter((entry) => entry.type === 'admin_custom')
    .map((entry) => entry.domain.toLowerCase());
}

/** The hostnames valid for one surface, custom domains included. */
export function hostsForSurface(tenant: TenantRecord, surface: 'admin' | 'storefront'): string[] {
  return surface === 'admin' ? adminHostsOf(tenant) : storefrontHostsOf(tenant);
}

/** Drops the cached record so a suspension takes effect on the next request. */
export async function invalidateTenant(slug: string, domains: string[] = []): Promise<void> {
  const keys = [`${CACHE_PREFIX}${slug}`, ...domains.map((d) => `${CACHE_PREFIX}domain:${d.toLowerCase()}`)];
  await redis.del(...keys).catch(() => undefined);
}

export async function reportUsage(
  tenantRef: string,
  usage: { products: number; admins: number; storageMb: number },
): Promise<void> {
  try {
    await callCompany(`/api/v1/internal/tenants/${encodeURIComponent(tenantRef)}/usage`, {
      method: 'POST',
      body: JSON.stringify(usage),
    });
  } catch (error) {
    // Usage reporting is best-effort; never fail a request because of it.
    logger.warn({ err: (error as Error).message, tenantRef }, 'usage report failed');
  }
}

export interface StoreAvailability {
  allowed: boolean;
  code?: string;
  message?: string;
}

/**
 * A store may trade only when both lifecycle fields agree. Company-side
 * reactivation can leave `status: 'expired'` with `storeStatus: 'ready'`, so
 * checking `storeStatus` alone is not enough.
 */
export function checkStoreAvailability(tenant: TenantRecord): StoreAvailability {
  if (tenant.status === 'suspended' || tenant.storeStatus === 'suspended') {
    return {
      allowed: false,
      code: ERROR_CODES.STORE_SUSPENDED,
      message: 'This store is suspended. Contact platform support to restore access.',
    };
  }

  if (tenant.status === 'expired') {
    return {
      allowed: false,
      code: ERROR_CODES.STORE_EXPIRED,
      message: 'Your trial or subscription has ended. Renew it from your account area to continue.',
    };
  }

  if (tenant.status === 'cancelled') {
    return {
      allowed: false,
      code: ERROR_CODES.STORE_EXPIRED,
      message: 'This store’s subscription was cancelled.',
    };
  }

  if (tenant.storeStatus !== 'ready') {
    return {
      allowed: false,
      code: ERROR_CODES.STORE_NOT_READY,
      message:
        tenant.storeStatus === 'creating'
          ? 'Your store is still being created. This usually takes under a minute.'
          : 'Your store is not ready yet.',
    };
  }

  return { allowed: true };
}

export function requireTenant(tenant: TenantRecord | null, slug: string): TenantRecord {
  if (!tenant) throw notFound(`No store found for “${slug}”.`, ERROR_CODES.STORE_NOT_FOUND);
  return tenant;
}
