import type { Metadata } from 'next';
import {
  INVENTORY_DEFAULTS,
  InventoryManager,
  type InventoryFilterState,
  type StockSort,
} from '@/components/admin/inventory-manager';
import { serverGet, serverGetListed, serverGetOptional } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import {
  can,
  type InventoryRow,
  type InventoryStats,
  type SessionResponse,
  type WarehouseRow,
} from '@/lib/types';

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = single(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };

  const filters: InventoryFilterState = {
    search: single('search') ?? '',
    status: oneOf('status', ['all', 'in_stock', 'low', 'out'] as const, 'all'),
    warehouseId: single('warehouse') ?? '',
    sort: oneOf(
      'sort',
      ['available', 'reserved', 'product', 'warehouse', 'updatedAt'] as const satisfies readonly StockSort[],
      INVENTORY_DEFAULTS.sort,
    ),
    order: oneOf('order', ['asc', 'desc'] as const, INVENTORY_DEFAULTS.order),
  };

  const [session, stats, warehouses, levels] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    // A card missing beats the whole screen failing, so the tally is optional.
    serverGetOptional<InventoryStats>('/api/v1/admin/inventory/stats'),
    serverGet<WarehouseRow[]>('/api/v1/admin/warehouses'),
    /*
     * The **first batch only**, and no cursor — which is what makes the API count
     * the filtered set and return `total`. The batches after it are fetched in
     * the browser by cursor and skip the count.
     */
    serverGetListed<InventoryRow>('/api/v1/admin/inventory', {
      pageSize: BATCH_SIZE,
      search: filters.search || undefined,
      status: filters.status,
      warehouseId: filters.warehouseId || undefined,
      sort: filters.sort,
      order: filters.order,
    }),
  ]);

  /*
   * Units held per warehouse, so the warehouses tab can say what is on each one's
   * shelves and warn before a delete the API is going to refuse. Read from the
   * first batch rather than as its own request: it is a hint on a card, and one
   * that is short because the reader has not scrolled is still more use than
   * nothing.
   */
  const unitsByWarehouse: Record<string, number> = {};
  for (const row of levels.data) {
    const held = row.available + row.reserved + row.returnPending + row.damaged + row.incoming;
    unitsByWarehouse[row.warehouseId] = (unitsByWarehouse[row.warehouseId] ?? 0) + held;
  }

  return (
    <InventoryManager
      initial={{ rows: levels.data, meta: levels.meta }}
      stats={stats}
      warehouses={warehouses}
      unitsByWarehouse={unitsByWarehouse}
      currency={session.authenticated ? session.store.currency : 'USD'}
      canAdjust={session.authenticated && can(session.admin, 'inventory.adjust')}
      filters={filters}
    />
  );
}
