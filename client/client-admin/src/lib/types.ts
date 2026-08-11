/** Mirrors the commerce API's response shapes. Kept hand-written and small. */

export type StoreRole = 'STORE_SUPER_ADMIN' | 'STORE_ADMIN';

export type Permission =
  | 'dashboard.view'
  | 'products.view'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'categories.view'
  | 'categories.manage'
  | 'brands.view'
  | 'brands.manage'
  | 'attributes.view'
  | 'attributes.manage'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'orders.view'
  | 'orders.update'
  | 'orders.cancel'
  | 'customers.view'
  | 'customers.update'
  | 'returns.view'
  | 'returns.approve'
  | 'returns.reject'
  | 'refunds.view'
  | 'refunds.approve'
  | 'reviews.view'
  | 'reviews.manage'
  | 'marketing.view'
  | 'marketing.manage'
  | 'website.view'
  | 'website.manage'
  | 'reports.view'
  | 'staff.view'
  | 'staff.create'
  | 'staff.update'
  | 'staff.delete'
  | 'settings.view'
  | 'settings.update';

export interface Entitlements {
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

export interface SessionStore {
  slug: string;
  name: string;
  currency: string;
  language: string;
  timezone: string;
  status: string;
  planCode: string | null;
  planName: string | null;
  trial: { status: string; endsAt: string | null; daysRemaining: number } | null;
  entitlements: Entitlements | null;
}

export interface SessionAdmin {
  id: string;
  email: string;
  fullName: string;
  roleKey: StoreRole;
  mfaEnabled: boolean;
  permissions: Permission[];
}

export type SessionResponse =
  | { authenticated: true; admin: SessionAdmin; store: SessionStore }
  | {
      authenticated: false;
      mfaRequired?: boolean;
      mfaPending?: boolean;
      store?: { slug: string; name: string; status: string };
    };

export interface AdminSessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/**
 * Authorisation is enforced by the API on every route; this only decides what
 * the panel bothers to render. A super admin implicitly holds everything.
 */
export function can(
  admin: Pick<SessionAdmin, 'roleKey' | 'permissions'> | null | undefined,
  permission: Permission,
): boolean {
  if (!admin) return false;
  if (admin.roleKey === 'STORE_SUPER_ADMIN') return true;
  return admin.permissions.includes(permission);
}

/** A metric plus its movement against the previous period, for KPI cards. */
export interface MetricDelta {
  value: number;
  previous: number;
  /** Null when there is no previous period to compare against. */
  changePct: number | null;
  /** Optional trend series for the inline sparkline. */
  spark?: number[];
}
