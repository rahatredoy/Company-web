import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { TenantExecutor } from '../../db/tenant-manager';
import {
  productMedia,
  productVariants,
  products,
} from '../../db/schema/index';
import { ERROR_CODES, unprocessable } from '../../lib/errors';
import { moneyToNumber, toMoney } from '../../lib/utils';
import {
  MeasureError,
  priceForMeasure,
  resolveMeasureConfig,
  resolveRequestedMeasure,
  type MeasureOption,
} from '../../lib/measure';

export interface RequestedLine {
  productId: string;
  variantId: string;
  quantity: number;
  /**
   * Which measure this line buys, in base units, for a product sold by weight
   * or volume. Absent on an ordinary line, and checked against the product's own
   * option list below rather than trusted — it arrives from `localStorage`, the
   * same place the quantity does.
   */
  measure?: number | null;
}

export interface PricedLine {
  productId: string;
  variantId: string;
  productName: string;
  variantTitle: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  /** The measure snapshot for the order line, or null for a plain product. */
  measureLabel: string | null;
  measure: number | null;
  /**
   * What this line takes off the shelf, in whatever the variant's stock is
   * counted in — base units for a measure product, whole items otherwise.
   *
   * Carried separately from `quantity` because the two are only the same number
   * for an ordinary product: 2 x 500gm is a quantity of two and a kilo of stock,
   * and reserving two grams of pumpkin would be an oversell of five hundred to
   * one.
   */
  stockUnits: number;
  /** List price, kept so a receipt can show what was struck through. */
  unitPrice: string;
  /** What is actually charged, when a live sale beats the list price. */
  unitSalePrice: string | null;
  lineTotal: string;
}

/**
 * Re-prices the basket from the database.
 *
 * The browser sends ids and quantities and no money at all, which is the only
 * arrangement that can be trusted: the cart lives in `localStorage`, so anything
 * priced there is a number the customer could have edited. Everything below —
 * price, sale price, availability — is read fresh here and nothing from the
 * request survives except which variant and how many.
 */
export async function priceLines(
  db: TenantExecutor,
  requested: RequestedLine[],
  measureDefaults: MeasureOption[] = [],
): Promise<PricedLine[]> {
  const variantIds = [...new Set(requested.map((line) => line.variantId))];

  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      variantImage: productVariants.imageUrl,
      price: productVariants.price,
      salePrice: productVariants.salePrice,
      status: products.status,
      variantActive: productVariants.isActive,
      sellBy: products.sellBy,
      measureUnit: products.measureUnit,
      pricingMeasure: products.pricingMeasure,
      pricingLabel: products.pricingLabel,
      minMeasure: products.minMeasure,
      measureOptions: products.measureOptions,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));

  const byVariant = new Map(rows.map((row) => [row.variantId, row]));

  // Fallback image: the product's own primary, for a variant that has none.
  const productIds = [...new Set(rows.map((row) => row.productId))];
  const media = productIds.length
    ? await db
        .select({ productId: productMedia.productId, url: productMedia.url })
        .from(productMedia)
        .where(and(inArray(productMedia.productId, productIds), eq(productMedia.type, 'image')))
        .orderBy(asc(productMedia.sortOrder))
    : [];

  const primaryImage = new Map<string, string>();
  for (const item of media) if (!primaryImage.has(item.productId)) primaryImage.set(item.productId, item.url);

  const priced: PricedLine[] = [];

  for (const line of requested) {
    const variant = byVariant.get(line.variantId);

    /*
     * An unknown, withdrawn or deactivated line is refused rather than silently
     * dropped. A basket that quietly loses an item and charges for the rest is
     * the kind of thing a customer only notices when the parcel arrives.
     */
    if (!variant || variant.status !== 'active' || !variant.variantActive) {
      throw unprocessable(
        'Something in your basket is no longer available. Please review it and try again.',
        ERROR_CODES.VALIDATION_FAILED,
        { lines: ['One or more items are no longer available.'] },
      );
    }

    if (variant.productId !== line.productId) {
      throw unprocessable(
        'Something in your basket does not look right. Please review it and try again.',
        ERROR_CODES.VALIDATION_FAILED,
        { lines: ['One or more items are no longer available.'] },
      );
    }

    const sale = variant.salePrice;

    /*
     * A measure product's stored price is a *rate* — what `pricing_measure` base
     * units cost — so the line's unit price is that rate scaled to the measure
     * chosen, and the scaling happens here rather than in the browser for the
     * same reason nothing else about money does. An unrecognised measure or one
     * under the shop's minimum is refused rather than adjusted: silently selling
     * a different amount from the one that was picked is the one outcome a till
     * must never have.
     */
    const config = resolveMeasureConfig(
      {
        sellBy: variant.sellBy,
        measureUnit: variant.measureUnit,
        pricingMeasure: variant.pricingMeasure,
        pricingLabel: variant.pricingLabel,
        minMeasure: variant.minMeasure,
        measureOptions: variant.measureOptions,
      },
      measureDefaults,
    );

    let chosen: { measure: number; label: string; totalMeasure: number } | null = null;
    try {
      chosen = resolveRequestedMeasure(config, { measure: line.measure, quantity: line.quantity });
    } catch (error) {
      if (error instanceof MeasureError) {
        throw unprocessable(error.message, ERROR_CODES.VALIDATION_FAILED, { lines: [error.message] });
      }
      throw error;
    }

    const unitPrice = chosen
      ? priceForMeasure(variant.price, chosen.measure, config!.pricingMeasure)
      : variant.price;
    const unitSalePrice =
      chosen && sale !== null ? priceForMeasure(sale, chosen.measure, config!.pricingMeasure) : sale;
    const charged = unitSalePrice ?? unitPrice;

    priced.push({
      productId: variant.productId,
      variantId: variant.variantId,
      productName: variant.productName,
      variantTitle: chosen ? chosen.label : variant.variantTitle,
      sku: variant.sku,
      imageUrl: variant.variantImage ?? primaryImage.get(variant.productId) ?? null,
      quantity: line.quantity,
      measureLabel: chosen?.label ?? null,
      measure: chosen?.measure ?? null,
      stockUnits: chosen?.totalMeasure ?? line.quantity,
      unitPrice,
      unitSalePrice,
      lineTotal: toMoney(moneyToNumber(charged) * line.quantity),
    });
  }

  return priced;
}

/**
 * Moves stock from `available` to `reserved` for one variant.
 *
 * A single conditional `UPDATE`, never read-then-write: two checkouts racing for
 * the last unit both read "1 available", and only the arrangement below lets
 * exactly one of them win. The `>= 0` CHECK on the column is the backstop; this
 * returns false first so the caller can answer `INSUFFICIENT_STOCK` rather than
 * surfacing a constraint violation.
 *
 * Stock is untracked in two different ways and both mean "sell it" — the same
 * rule the listing and the badge use. `products.track_inventory` off is the
 * owner saying stock must never refuse a sale; no `inventory_levels` rows at all
 * is a shop that has never opened the inventory screens, where reading the
 * absence as zero would take the whole catalogue off sale.
 */
export async function reserveStock(
  tx: TenantExecutor,
  variantId: string,
  quantity: number,
): Promise<{ reserved: boolean; tracked: boolean; availableAfter: number; warehouseId: string | null }> {
  /*
   * Asked first, and separately, because it is a refusal to *count* rather than a
   * count: folding it into the conditional UPDATE below would still move the
   * units, and an untracked product's level is a record of what is on the shelf,
   * not a permission to sell from it.
   */
  const tracking = await tx.execute<{ track_inventory: boolean }>(sql`
    select p.track_inventory
      from product_variants v
      join products p on p.id = v.product_id
     where v.id = ${variantId}::uuid
     limit 1
  `);

  if (tracking.rows?.[0]?.track_inventory === false) {
    return { reserved: true, tracked: false, availableAfter: 0, warehouseId: null };
  }

  const result = await tx.execute<{ id: string; warehouse_id: string; available: number; reserved: number }>(sql`
    update inventory_levels
       set available = available - ${quantity},
           reserved  = reserved  + ${quantity},
           updated_at = now()
     where id = (
       select id from inventory_levels
        where variant_id = ${variantId}::uuid and available >= ${quantity}
        order by available desc
        limit 1
     )
    returning id, warehouse_id, available, reserved
  `);

  const row = result.rows?.[0];
  if (row) {
    return {
      reserved: true,
      tracked: true,
      availableAfter: Number(row.available),
      warehouseId: row.warehouse_id,
    };
  }

  const existing = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from inventory_levels where variant_id = ${variantId}::uuid
  `);

  const tracked = Number(existing.rows?.[0]?.count ?? 0) > 0;
  return { reserved: !tracked, tracked, availableAfter: 0, warehouseId: null };
}

/** Puts reserved stock back — used when an order is cancelled before dispatch. */
export async function releaseStock(
  tx: TenantExecutor,
  variantId: string,
  quantity: number,
): Promise<{ released: boolean; availableAfter: number; warehouseId: string | null }> {
  const result = await tx.execute<{ warehouse_id: string; available: number }>(sql`
    update inventory_levels
       set available = available + ${quantity},
           reserved  = greatest(reserved - ${quantity}, 0),
           updated_at = now()
     where id = (
       select id from inventory_levels
        where variant_id = ${variantId}::uuid
        order by reserved desc
        limit 1
     )
    returning warehouse_id, available
  `);

  const row = result.rows?.[0];
  return row
    ? { released: true, availableAfter: Number(row.available), warehouseId: row.warehouse_id }
    : { released: false, availableAfter: 0, warehouseId: null };
}
