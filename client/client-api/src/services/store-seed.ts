import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { TenantDb } from '../db/tenant-manager';
import { storeAdmins, storeSettings, storefrontSettings } from '../db/schema/index';
import { DEFAULT_THEME, DEFAULT_TEMPLATE, STORE_ROLES, normaliseTemplateKey } from '../lib/constants';
import { logger } from '../lib/logger';
import { seedRolesAndPermissions } from './permissions';

/** One attempt per tenant per process — the work is idempotent but not free. */
const seeded = new Set<string>();

/**
 * Reconciles a freshly provisioned (or newly migrated) tenant database with what
 * the commerce platform expects to find in it.
 *
 * Company provisioning only creates three tables and one owner row, and it does
 * so with its own vocabulary (`role='owner'`, hyphenated template keys). Rather
 * than teach every query about both dialects, the difference is normalised once,
 * here, right after the schema is brought up to date.
 */
export async function ensureStoreSeed(db: TenantDb, tenantRef: string): Promise<void> {
  if (seeded.has(tenantRef)) return;
  seeded.add(tenantRef);

  try {
    await seedRolesAndPermissions(db);
    await normaliseProvisionedOwner(db);
    await ensureStorefrontSettings(db);
  } catch (error) {
    // A failed seed must not poison the pool — let the next request retry.
    seeded.delete(tenantRef);
    throw error;
  }
}

/**
 * The owner row the company platform seeds has `role='owner'` and no role key of
 * ours. Promoting it here — rather than only in the migration — covers stores
 * provisioned after this deploy, whose migration has already run.
 */
async function normaliseProvisionedOwner(db: TenantDb): Promise<void> {
  const promoted = await db
    .update(storeAdmins)
    .set({ roleKey: STORE_ROLES.superAdmin })
    .where(and(eq(storeAdmins.role, 'owner'), eq(storeAdmins.roleKey, STORE_ROLES.admin)))
    .returning({ id: storeAdmins.id });

  /*
   * `status` is the company's column, `account_status` is ours, and provisioning
   * only ever writes theirs. A password is the whole of the difference: the row
   * arrives with the one its owner registered with — and gets a new one whenever
   * they change it on the company side — so a hash present means the account can
   * sign in, whatever the two status columns were last left saying.
   */
  await db
    .update(storeAdmins)
    .set({ accountStatus: 'active' })
    .where(and(eq(storeAdmins.accountStatus, 'invited'), isNotNull(storeAdmins.passwordHash)));

  await db
    .update(storeAdmins)
    .set({ accountStatus: 'invited' })
    .where(and(eq(storeAdmins.status, 'invited'), isNull(storeAdmins.passwordHash)));

  if (promoted.length > 0) {
    logger.info({ count: promoted.length }, 'promoted provisioned owner to store super admin');
  }
}

/**
 * The design row is a singleton. Its initial template comes from whatever the
 * customer chose at sign-up, translated from the company's hyphenated key.
 */
async function ensureStorefrontSettings(db: TenantDb): Promise<void> {
  const existing = await db.select({ id: storefrontSettings.id }).from(storefrontSettings).limit(1);
  if (existing.length > 0) return;

  const [settings] = await db
    .select({ template: storeSettings.storefrontTemplate })
    .from(storeSettings)
    .limit(1);

  await db.insert(storefrontSettings).values({
    templateKey: settings ? normaliseTemplateKey(settings.template) : DEFAULT_TEMPLATE,
    colorThemeKey: DEFAULT_THEME,
  });
}

/** Test/CLI helper: forget the memo so a seed can be re-run in the same process. */
export function resetStoreSeedCache(tenantRef?: string): void {
  if (tenantRef) seeded.delete(tenantRef);
  else seeded.clear();
}
