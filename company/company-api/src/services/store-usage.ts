import { tenantAdminConnection } from '../db/tenant-connection';
import { tenants } from '../db/schema/index';
import { logger } from '../lib/logger';

type Tenant = typeof tenants.$inferSelect;

export interface StoreUsage {
  /** Products in the catalogue, or null when the store has no database yet. */
  products: number | null;
  /** Admin accounts that can open the panel. The singleton index caps this at 1. */
  admins: number | null;
  /** Bytes held by uploaded media, or null when nothing stores media yet. */
  storageBytes: number | null;
}

const EMPTY: StoreUsage = { products: null, admins: null, storageBytes: null };

/**
 * What the store is actually using, counted in its own database.
 *
 * The company platform owns the plan limits but none of the things being
 * limited — products, media and admins all live on the client side — so this
 * reaches into the tenant database and counts them rather than reporting a
 * number the control database cannot know.
 *
 * Every table is checked for existence first. A tenant is provisioned with only
 * the three bootstrap tables; the rest arrive when the client API first migrates
 * it, so a store that has never been opened is missing most of this schema and
 * that is not an error — it is a store with nothing in it yet.
 */
export async function readStoreUsage(tenant: Tenant): Promise<StoreUsage> {
  if (!tenant.databaseName) return EMPTY;
  if (tenant.storeStatus !== 'ready' && tenant.storeStatus !== 'suspended') return EMPTY;

  const client = tenantAdminConnection(tenant.databaseName);

  try {
    await client.connect();

    const present = await client.query<{
      products: string | null;
      store_admins: string | null;
      product_media: string | null;
      return_attachments: string | null;
    }>(`select to_regclass('public.products')            as products,
               to_regclass('public.store_admins')        as store_admins,
               to_regclass('public.product_media')       as product_media,
               to_regclass('public.return_attachments')  as return_attachments`);

    const tables = present.rows[0];
    if (!tables) return EMPTY;

    // A missing catalogue means zero products, not unknown — nothing on the
    // platform can have created one. Storage is different: with no media table
    // there is no figure to give, so it stays null and the UI shows a dash.
    const mediaSources = [
      tables.product_media ? 'select coalesce(sum(size_bytes), 0) as bytes from product_media' : null,
      tables.return_attachments
        ? 'select coalesce(sum(size_bytes), 0) as bytes from return_attachments'
        : null,
    ].filter(Boolean);

    const [products, admins, storage] = await Promise.all([
      tables.products
        ? client.query<{ count: string }>('select count(*)::text as count from products')
        : Promise.resolve(null),
      tables.store_admins
        ? client.query<{ count: string }>('select count(*)::text as count from store_admins')
        : Promise.resolve(null),
      mediaSources.length
        ? client.query<{ bytes: string }>(
            `select coalesce(sum(bytes), 0)::text as bytes from (${mediaSources.join(' union all ')}) as media`,
          )
        : Promise.resolve(null),
    ]);

    return {
      products: products ? Number(products.rows[0]?.count ?? 0) : 0,
      admins: admins ? Number(admins.rows[0]?.count ?? 0) : null,
      storageBytes: storage ? Number(storage.rows[0]?.bytes ?? 0) : null,
    };
  } catch (error) {
    // Usage is a decoration on a page that must still render. A tenant database
    // that is unreachable is worth a log line, not a broken store page.
    logger.warn(
      { tenantId: tenant.id, err: error instanceof Error ? error.message : String(error) },
      'could not read store usage',
    );
    return EMPTY;
  } finally {
    await client.end().catch(() => undefined);
  }
}
