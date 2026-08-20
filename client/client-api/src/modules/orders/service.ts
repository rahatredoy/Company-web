import { eq, sql } from 'drizzle-orm';
import type { TenantExecutor } from '../../db/tenant-manager';
import { inventoryTransactions, orderItems, products } from '../../db/schema/index';
import { stockUnitsOf } from '../../lib/measure';

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
 *
 * For a product sold by measure the two numbers below deliberately differ.
 * **Stock moves in base units** — a line of 2 x 500gm takes a kilo off the shelf
 * — while **`sold_count` moves by the line's quantity**, because it is a ranking
 * and grams are not comparable with shirts: counting the pumpkin's kilo as a
 * thousand would put it above every other product in the shop forever. What was
 * actually weighed out is in the ledger, in base units, which is where the
 * product screen reads it from.
 */
export async function fulfilOrderStock(tx: TenantExecutor, orderId: string): Promise<void> {
  const lines = await tx
    .select({
      variantId: orderItems.variantId,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      measure: orderItems.measure,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const line of lines) {
    const stockUnits = stockUnitsOf(line);

    if (line.productId) {
      await tx
        .update(products)
        .set({ soldCount: sql`${products.soldCount} + ${line.quantity}` })
        .where(eq(products.id, line.productId));
    }

    if (!line.variantId) continue;

    const result = await tx.execute<{ warehouse_id: string; available: number; reserved: number }>(sql`
      update inventory_levels
         set reserved = greatest(reserved - ${stockUnits}, 0),
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
      quantity: -stockUnits,
      fromBucket: 'reserved',
      toBucket: null,
      availableAfter: Number(row.available),
      reservedAfter: Number(row.reserved),
      referenceType: 'order',
      referenceId: orderId,
    });
  }
}
