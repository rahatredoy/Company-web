import { eq, notInArray, sql } from 'drizzle-orm';
import type { TenantDb } from '../db/tenant-manager';
import {
  adminPermissions,
  adminRolePermissions,
  adminRoles,
  adminUserPermissions,
} from '../db/schema/index';
import {
  DEFAULT_STORE_ADMIN_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  STORE_ROLES,
  type Permission,
  type StoreRole,
} from '../lib/constants';
import { forbidden } from '../lib/errors';
import { ERROR_CODES } from '../lib/errors';

const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  manage: 'Manage',
  adjust: 'Adjust',
  cancel: 'Cancel',
  approve: 'Approve',
  reject: 'Reject',
};

const SUBJECT_LABELS: Record<string, string> = {
  dashboard: 'dashboard',
  products: 'products',
  categories: 'categories',
  brands: 'brands',
  attributes: 'attributes',
  inventory: 'inventory',
  orders: 'orders',
  customers: 'customers',
  returns: 'returns',
  refunds: 'refunds',
  reviews: 'reviews',
  marketing: 'marketing',
  website: 'website content',
  settings: 'settings',
};

/**
 * Labels are derived rather than hand-maintained so the catalogue can never
 * drift out of sync with `PERMISSIONS`.
 */
function labelFor(key: Permission): string {
  const [subject = '', action = ''] = key.split('.');
  const verb = ACTION_LABELS[action] ?? action;
  return `${verb} ${SUBJECT_LABELS[subject] ?? subject}`.trim();
}

function groupFor(key: Permission): string {
  return PERMISSION_GROUPS.find((entry) => entry.permissions.includes(key))?.group ?? 'Other';
}

/**
 * Brings the tenant's role and permission catalogue up to date.
 *
 * Runs once per tenant per process boot (see `ensureStoreSeed`), and is fully
 * idempotent: adding a permission key to `lib/constants.ts` and redeploying is
 * all that is needed to roll it out to every store, and removing one retires it
 * the same way.
 */
export async function seedRolesAndPermissions(db: TenantDb): Promise<void> {
  // A key no longer in `PERMISSIONS` guards nothing. Its grants go with it —
  // both grant tables cascade from `admin_permissions.key`.
  await db.delete(adminPermissions).where(notInArray(adminPermissions.key, [...PERMISSIONS]));

  await db
    .insert(adminPermissions)
    .values(
      PERMISSIONS.map((key, index) => ({
        key,
        groupName: groupFor(key),
        label: labelFor(key),
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: adminPermissions.key,
      set: {
        groupName: sql`excluded.group_name`,
        label: sql`excluded.label`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

  await db
    .insert(adminRoles)
    .values([
      {
        key: STORE_ROLES.superAdmin,
        name: 'Store Super Admin',
        description: 'Full access to everything in this store, including settings.',
        isSystem: true,
      },
      {
        key: STORE_ROLES.admin,
        name: 'Store Admin',
        description: 'Day-to-day access, limited to the permissions granted to them.',
        isSystem: true,
      },
    ])
    .onConflictDoNothing({ target: adminRoles.key });

  // Baseline grants for the STORE_ADMIN role.
  const [role] = await db
    .select({ id: adminRoles.id })
    .from(adminRoles)
    .where(eq(adminRoles.key, STORE_ROLES.admin))
    .limit(1);

  if (role) {
    await db
      .insert(adminRolePermissions)
      .values(DEFAULT_STORE_ADMIN_PERMISSIONS.map((key) => ({ roleId: role.id, permissionKey: key })))
      .onConflictDoNothing();
  }
}

/**
 * The effective permission set for one admin.
 *
 * A `STORE_SUPER_ADMIN` is not represented in `admin_user_permissions` at all —
 * their access is implicit, so it cannot be silently revoked by deleting rows,
 * and a bug in the grants table can never lock the owner out of their own store.
 */
export async function effectivePermissions(
  db: TenantDb,
  admin: { id: string; roleKey: StoreRole },
): Promise<Set<Permission>> {
  if (admin.roleKey === STORE_ROLES.superAdmin) return new Set(PERMISSIONS);

  const rows = await db
    .select({ key: adminUserPermissions.permissionKey })
    .from(adminUserPermissions)
    .where(eq(adminUserPermissions.adminId, admin.id));

  return new Set(rows.map((row) => row.key as Permission));
}

export function assertPermission(granted: Set<Permission>, key: Permission): void {
  if (!granted.has(key)) {
    throw forbidden(
      'You do not have permission to do that. Ask a store super admin for access.',
      ERROR_CODES.PERMISSION_DENIED,
    );
  }
}
