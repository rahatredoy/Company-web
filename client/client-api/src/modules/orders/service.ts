import { eq, sql } from 'drizzle-orm';
import type { TenantExecutor } from '../../db/tenant-manager';
import { inventoryTransactions, orderItems, products } from '../../db/schema/index';

/**
 * Turns a reservation into a sale.
 *
 * Dispatch is the point at which stock stops being held for an order and starts
 * being gone: `reserved` comes down and nothing goes back to `available`,
 * because the units have left the building. The ledger row is what makes that
 * explainable afterwards — every movement in `inventory_levels` has one, so a
 * level can always be replayed rather than guessed at.
 *
 * `products.sold_count` is bumped here too, and this is the only place it moves.
 * It drives the best-seller sort and badge, so a shop that counted it at
 * checkout would rank abandoned and cancelled orders alongside real ones.
 */
export async function fulfilOrderStock(tx: TenantExecutor, orderId: string): Promise<void> {
  const lines = await tx
    .select({
      variantId: orderItems.variantId,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const line of lines) {
    if (line.productId) {
      await tx
        .update(products)
        .set({ soldCount: sql`${products.soldCount} + ${line.quantity}` })
        .where(eq(products.id, line.productId));
    }

    if (!line.variantId) continue;

    const result = await tx.execute<{ warehouse_id: string; available: number; reserved: number }>(sql`
      update inventory_levels
         set reserved = greatest(reserved - ${line.quantity}, 0),
             updated_at = now()
       where id = (
         select id from inventory_levels
          where variant_id = ${line.variantId}::uuid and reserved > 0
          order by reserved desc
          limit 1
       )
      returning warehouse_id, available, reserved
    `);

    const row = result.rows?.[0];
    if (!row) continue;

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      warehouseId: row.warehouse_id,
      type: 'order_fulfilled',
      quantity: -line.quantity,
      fromBucket: 'reserved',
      toBucket: null,
      availableAfter: Number(row.available),
      reservedAfter: Number(row.reserved),
      referenceType: 'order',
      referenceId: orderId,
    });
  }
}
