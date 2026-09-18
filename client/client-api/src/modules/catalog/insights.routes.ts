import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenantExecutor } from '../../db/tenant-manager';
import { notFound } from '../../lib/errors';
import { ok, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';

/**
 * Everything the panel's product screen shows about one product, in one call.
 *
 * A **screen endpoint**, like `/admin/dashboard` and for the same reason: the
 * page asks nine unrelated questions of eight tables about a single row, and
 * answering them from nine endpoints would be nine round trips, nine sessions
 * checked and nine chances for one slow aggregate to hold up the render. Its
 * shape follows the page and is not a resource contract — `/products/:id` is,
 * and it is what the editor still writes against.
 *
 * Read-only throughout. Nothing here is cached: it is behind a session,
 * `plugins/security.ts` marks the admin surface `no-store`, and an owner
 * checking what is left on the shelf is the one reader who must not be shown a
 * minute-old count.
 *
 * ## The two numbers that look like each other
 *
 * `stock.sold` is `products.sold_count`, which moves **on dispatch and nowhere
 * else** — it is the figure the catalogue list sorts by and the storefront's
 * best-seller badge reads. `money.units` is what has been *ordered* on orders
 * that were neither cancelled nor failed and were charged in the store's current
 * currency, which is the only basis the revenue beside it can be divided by. A shop with parcels still to pack will see the
 * second exceed the first, and that is the truth rather than a discrepancy, so
 * both are returned and each is labelled by what it counts.
 *
 * ## What is estimated, and why it says so
 *
 * Cost is read from `product_variants.cost_price` **as it is now**, because an
 * order line snapshots what the customer was charged and never what the unit
 * cost the shop — so profit here is today's margin applied to past sales. It is
 * the only answer available and it is worth having; it is named `estimated` so
 * nobody files it as an accounting figure.
 */

const querySchema = z.object({
  /** The sales chart's window, in whole store-local days. */
  days: z.coerce.number().int().min(7).max(365).default(30),
});

/**
 * Orders that represent money — the same filter the dashboard uses. A cancelled
 * order was never revenue, and counting it would make a dead week look like a
 * good one.
 */
const COUNTED = sql`o.status not in ('cancelled', 'failed')`;

/**
 * An order charged in the currency the store trades in now.
 *
 * `orders.currency` is snapshotted at checkout, so a store that has switched
 * currency holds orders in both, and this screen prints every money figure with
 * one symbol. Read from `store_settings` in the query itself — the same row the
 * response's `currency` comes from — so the filter and the label cannot differ.
 * An uncorrelated subquery, so Postgres evaluates it once, not per row.
 */
const IN_STORE_CURRENCY = sql`o.currency = (select min(currency) from store_settings)`;

/**
 * Ledger types that put units **on** the shelf under the shop's own hand.
 *
 * A restocked return and a repair are deliberately not here: they are units
 * coming back, which the returns block already accounts for, and adding them to
 * "received" would double-count a unit that was bought, returned and resold.
 */
const RECEIPT_TYPES = sql`t.type in ('initial', 'received', 'adjustment', 'transfer')`;

/** Returns still on somebody's desk — neither settled nor refused. */
const RETURN_OPEN = sql`r.status in ('requested', 'under_review', 'approved', 'received', 'inspected')`;

/**
 * How much of an order-level figure belongs to one line.
 *
 * A coupon is applied to the basket, not to a product, so the only honest way to
 * ask "what did this product cost us in discount" is to split it by what each
 * line contributed to the subtotal it was calculated against. Guarded on a zero
 * subtotal, which a fully-discounted order can genuinely have.
 */
const shareOf = (column: ReturnType<typeof sql>) =>
  sql`case when o.subtotal > 0 then ${column} * (oi.line_total / o.subtotal) else 0 end`;

const money = (expression: ReturnType<typeof sql>) =>
  sql`coalesce(${expression}, 0)::numeric(14,2)::text`;

type StockRow = {
  available: number;
  reserved: number;
  return_pending: number;
  damaged: number;
  incoming: number;
  levels: number;
  threshold: number;
  variants: number;
}

type LedgerRow = {
  received: number;
  restocked: number;
  written_off: number;
}

type MoneyRow = {
  revenue: string;
  discount: string;
  refunded: string;
  cost: string;
  units: number;
  orders: number;
}

type SeriesRow = {
  bucket: string;
  units: number;
  revenue: string;
}

type VariantRow = {
  id: string;
  sku: string;
  title: string | null;
  price: string;
  sale_price: string | null;
  cost_price: string | null;
  image_url: string | null;
  is_default: boolean;
  is_active: boolean;
  available: number;
  reserved: number;
  return_pending: number;
  damaged: number;
  incoming: number;
  levels: number;
  threshold: number;
  sold: number;
  returned: number;
}

type MovementRow = {
  id: string;
  type: string;
  quantity: number;
  from_bucket: string | null;
  to_bucket: string | null;
  available_after: number;
  reserved_after: number;
  reference_type: string | null;
  reference_id: string | null;
  order_number: string | null;
  damage_reason: string | null;
  note: string | null;
  admin_label: string | null;
  sku: string;
  variant_title: string | null;
  created_at: Date;
}

type ReturnsRow = {
  requests: number;
  units: number;
  open: number;
  restocked: number;
  damaged: number;
  value: string;
}

type ActivityRow = {
  wishlist: number;
  reviews_approved: number;
  reviews_pending: number;
}

/**
 * A gap-free daily series for one product, bucketed in the **store's** timezone.
 *
 * Generated from a calendar and left-joined, exactly as the dashboard's is: a
 * day with no sales has to arrive as a zero rather than as a missing point,
 * because a chart that closes the gap draws a trend that never happened. The
 * buckets are built in local time and converted back, which is what keeps them
 * on local midnight across a DST change.
 */
async function salesSeries(db: TenantExecutor, productId: string, days: number) {
  const result = await db.execute<SeriesRow>(sql`
    with zone as (
      select coalesce(min(timezone), 'UTC') as tz from store_settings
    ),
    window_bounds as (
      select
        tz,
        (date_trunc('day', now() at time zone tz) - make_interval(days => ${days - 1})) at time zone tz as starts_at,
        (date_trunc('day', now() at time zone tz) + interval '1 day') at time zone tz as ends_at
      from zone
    ),
    slots as (
      select
        g.local_start,
        g.local_start at time zone b.tz as starts_at,
        (g.local_start + interval '1 day') at time zone b.tz as ends_at
      from window_bounds b,
        generate_series(
          date_trunc('day', b.starts_at at time zone b.tz),
          date_trunc('day', (b.ends_at - interval '1 second') at time zone b.tz),
          interval '1 day'
        ) as g(local_start)
    )
    select
      to_char(slots.local_start, 'YYYY-MM-DD') as bucket,
      coalesce(sum(oi.quantity), 0)::int as units,
      ${money(sql`sum(oi.line_total) filter (where ${IN_STORE_CURRENCY})`)} as revenue
    from slots
    left join orders o
      on o.placed_at >= slots.starts_at
     and o.placed_at <  slots.ends_at
     and ${COUNTED}
    left join order_items oi
      on oi.order_id = o.id
     and oi.product_id = ${productId}::uuid
    group by slots.local_start
    order by slots.local_start
  `);

  return (result.rows ?? []).map((row) => ({
    bucket: row.bucket,
    units: Number(row.units ?? 0),
    revenue: row.revenue ?? '0',
  }));
}

/**
 * One product, measured rather than edited.
 *
 * Registered before `productRoutes` would make no difference — find-my-way
 * matches `/products/:id/insights` on its own segments — but it lives in its own
 * file because it shares nothing with the write path: no validation, no
 * transaction, no audit, and a shape that answers to a screen rather than to a
 * resource.
 */
export default async function productInsightsRoutes(app: FastifyInstance) {
  app.get(
    '/products/:id/insights',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const query = parseQuery(querySchema, request.query);

      /*
       * The head first, and alone. Everything below aggregates over this
       * product's variants and order lines, and running eight aggregates against
       * an id that does not exist is eight empty scans and a 200 describing
       * nothing — the reader deserves the 404.
       */
      const head = await store.db.execute<{
        id: string;
        name: string;
        slug: string;
        status: string;
        type: string;
        video_url: string | null;
        track_inventory: boolean;
        sold_count: number;
        view_count: number;
        rating_average: string;
        rating_count: number;
        is_featured: boolean;
        is_new_arrival: boolean;
        is_returnable: boolean;
        published_at: Date | null;
        created_at: Date;
        updated_at: Date;
        price_from: string | null;
        sale_price_from: string | null;
        category_id: string | null;
        category_name: string | null;
        parent_category_id: string | null;
        parent_category_name: string | null;
        brand_id: string | null;
        brand_name: string | null;
        sku: string | null;
        barcode: string | null;
        cost_price: string | null;
        image_url: string | null;
        currency: string;
        timezone: string;
      }>(sql`
        select
          p.id, p.name, p.slug, p.status, p.type,
          p.video_url, p.track_inventory,
          p.sold_count, p.view_count, p.rating_average, p.rating_count,
          p.is_featured, p.is_new_arrival, p.is_returnable,
          p.published_at, p.created_at, p.updated_at,
          p.price_from, p.sale_price_from,
          c.id as category_id, c.name as category_name,
          parent.id as parent_category_id, parent.name as parent_category_name,
          b.id as brand_id, b.name as brand_name,
          dv.sku, dv.barcode, dv.cost_price,
          /*
           * The variant's own picture first, the gallery second — the order the
           * storefront resolves a thumbnail in. A second, more optimistic answer
           * here would show the owner a picture their shoppers never see.
           */
          coalesce(
            dv.image_url,
            (select m.url from product_media m
              where m.product_id = p.id
              order by m.is_primary desc, m.sort_order asc
              limit 1)
          ) as image_url,
          (select coalesce(min(currency), 'USD') from store_settings) as currency,
          (select coalesce(min(timezone), 'UTC') from store_settings) as timezone
        from products p
        left join categories c on c.id = p.category_id
        -- The tree is two deep in the panel, so a product filed under a child
        -- names its parent as the category and itself as the subcategory. Read
        -- from the row rather than assumed, because a product may equally sit at
        -- the top level, where there is no subcategory to show.
        left join categories parent on parent.id = c.parent_id
        left join brands b on b.id = p.brand_id
        left join lateral (
          select v.sku, v.barcode, v.cost_price, v.image_url
            from product_variants v
           where v.product_id = p.id
           order by v.is_default desc, v.sort_order asc
           limit 1
        ) dv on true
        where p.id = ${id}::uuid
        limit 1
      `);

      const product = head.rows?.[0];
      if (!product) throw notFound('That product no longer exists.');

      const [stockResult, ledgerResult, moneyResult, series, variantResult, movementResult, returnsResult, activityResult] =
        await Promise.all([
          store.db.execute<StockRow>(sql`
            select
              coalesce(sum(l.available), 0)::int        as available,
              coalesce(sum(l.reserved), 0)::int         as reserved,
              coalesce(sum(l.return_pending), 0)::int   as return_pending,
              coalesce(sum(l.damaged), 0)::int          as damaged,
              coalesce(sum(l.incoming), 0)::int         as incoming,
              count(l.id)::int                          as levels,
              coalesce(max(l.low_stock_threshold), 0)::int as threshold,
              count(distinct v.id)::int                 as variants
            from product_variants v
            left join inventory_levels l on l.variant_id = v.id
            where v.product_id = ${id}::uuid
          `),

          store.db.execute<LedgerRow>(sql`
            select
              coalesce(sum(t.quantity) filter (where t.quantity > 0 and ${RECEIPT_TYPES}), 0)::int as received,
              coalesce(sum(t.quantity) filter (where t.type = 'return_restocked' and t.quantity > 0), 0)::int as restocked,
              coalesce(sum(t.quantity) filter (where t.type in ('damaged', 'disposed') and t.quantity > 0), 0)::int as written_off
            from inventory_transactions t
            join product_variants v on v.id = t.variant_id
            where v.product_id = ${id}::uuid
          `),

          store.db.execute<MoneyRow>(sql`
            select
              ${money(sql`sum(oi.line_total)`)} as revenue,
              /*
               * Three things a shopper never paid, added together: the sale
               * price cut off the ticket price, any line-level reduction, and
               * this line's share of an order-level coupon.
               */
              ${money(sql`sum(
                (oi.unit_price - coalesce(oi.unit_sale_price, oi.unit_price)) * oi.quantity
                + oi.line_discount
                + ${shareOf(sql`o.discount_total`)}
              )`)} as discount,
              ${money(sql`sum(${shareOf(sql`o.refunded_total`)})`)} as refunded,
              -- Today's cost price against past sales; the response says so.
              ${money(sql`sum(oi.quantity * coalesce(v.cost_price, 0))`)} as cost,
              coalesce(sum(oi.quantity), 0)::int as units,
              count(distinct o.id)::int as orders
            from order_items oi
            join orders o on o.id = oi.order_id
            left join product_variants v on v.id = oi.variant_id
            -- Units and orders are filtered with the money, not beside it: they
            -- are what the revenue is divided by, and an order in another
            -- currency contributed nothing to that revenue.
            where oi.product_id = ${id}::uuid and ${COUNTED} and ${IN_STORE_CURRENCY}
          `),

          salesSeries(store.db, id, query.days),

          store.db.execute<VariantRow>(sql`
            select
              v.id, v.sku, v.title, v.price, v.sale_price, v.cost_price, v.image_url,
              v.is_default, v.is_active,
              coalesce(l.available, 0)::int      as available,
              coalesce(l.reserved, 0)::int       as reserved,
              coalesce(l.return_pending, 0)::int as return_pending,
              coalesce(l.damaged, 0)::int        as damaged,
              coalesce(l.incoming, 0)::int       as incoming,
              coalesce(l.levels, 0)::int         as levels,
              coalesce(l.threshold, 0)::int      as threshold,
              -- Dispatched, from the ledger: the per-variant half of
              -- products.sold_count, which is only kept for the whole product.
              coalesce(sold.units, 0)::int       as sold,
              coalesce(ret.units, 0)::int        as returned
            from product_variants v
            left join lateral (
              select
                sum(il.available)::int as available, sum(il.reserved)::int as reserved,
                sum(il.return_pending)::int as return_pending, sum(il.damaged)::int as damaged,
                sum(il.incoming)::int as incoming, count(*)::int as levels,
                max(il.low_stock_threshold)::int as threshold
              from inventory_levels il where il.variant_id = v.id
            ) l on true
            left join lateral (
              select coalesce(sum(-t.quantity), 0)::int as units
                from inventory_transactions t
               where t.variant_id = v.id and t.type = 'order_fulfilled'
            ) sold on true
            left join lateral (
              select coalesce(sum(oi.returned_quantity), 0)::int as units
                from order_items oi where oi.variant_id = v.id
            ) ret on true
            where v.product_id = ${id}::uuid
            order by v.is_default desc, v.sort_order asc, v.sku asc
          `),

          store.db.execute<MovementRow>(sql`
            select
              t.id, t.type, t.quantity, t.from_bucket, t.to_bucket,
              t.available_after, t.reserved_after,
              t.reference_type, t.reference_id, t.damage_reason, t.note, t.admin_label,
              t.created_at,
              v.sku, v.title as variant_title,
              /*
               * A scalar subquery rather than a join: reference_id is a varchar
               * that holds an order id for some rows and a return id for
               * others, so joining on a cast would filter the ledger by what it
               * happens to point at. In the target list it is evaluated only for
               * the fifty rows that survive the limit.
               */
              (select o.order_number from orders o
                where t.reference_type = 'order' and o.id::text = t.reference_id) as order_number
            from inventory_transactions t
            join product_variants v on v.id = t.variant_id
            where v.product_id = ${id}::uuid
            order by t.created_at desc, t.id desc
            limit 50
          `),

          store.db.execute<ReturnsRow>(sql`
            select
              count(distinct r.id)::int                          as requests,
              coalesce(sum(ri.quantity), 0)::int                 as units,
              count(distinct r.id) filter (where ${RETURN_OPEN})::int as open,
              coalesce(sum(ri.restocked_quantity), 0)::int       as restocked,
              coalesce(sum(ri.quantity) filter (where ri.inspection_result = 'damaged'), 0)::int as damaged,
              ${money(sql`sum(ri.line_total) filter (where r.status = 'completed' and ${IN_STORE_CURRENCY})`)} as value
            from returns r
            join return_items ri on ri.return_id = r.id
            join order_items oi on oi.id = ri.order_item_id
            join orders o on o.id = oi.order_id
            where oi.product_id = ${id}::uuid
          `),

          store.db.execute<ActivityRow>(sql`
            select
              (select count(*)::int from wishlist_items w where w.product_id = ${id}::uuid) as wishlist,
              (select count(*)::int from reviews rv
                where rv.product_id = ${id}::uuid and rv.status = 'approved') as reviews_approved,
              (select count(*)::int from reviews rv
                where rv.product_id = ${id}::uuid and rv.status = 'pending') as reviews_pending
          `),
        ]);

      const stock = stockResult.rows?.[0];
      const ledger = ledgerResult.rows?.[0];
      const takings = moneyResult.rows?.[0];
      const returned = returnsResult.rows?.[0];
      const activity = activityResult.rows?.[0];

      const available = Number(stock?.available ?? 0);
      const threshold = Number(stock?.threshold ?? 0);
      const levels = Number(stock?.levels ?? 0);
      const soldUnits = Number(takings?.units ?? 0);
      const returnedUnits = Number(returned?.units ?? 0);

      const revenue = Number(takings?.revenue ?? 0);
      const refunded = Number(takings?.refunded ?? 0);
      const cost = Number(takings?.cost ?? 0);

      const variants = (variantResult.rows ?? []).map((row) => ({
        id: row.id,
        sku: row.sku,
        title: row.title,
        price: row.price,
        salePrice: row.sale_price,
        costPrice: row.cost_price,
        imageUrl: row.image_url,
        isDefault: row.is_default,
        isActive: row.is_active,
        available: Number(row.available ?? 0),
        reserved: Number(row.reserved ?? 0),
        returnPending: Number(row.return_pending ?? 0),
        damaged: Number(row.damaged ?? 0),
        incoming: Number(row.incoming ?? 0),
        /** Zero means nothing was ever recorded — not that the last one sold. */
        stockRecords: Number(row.levels ?? 0),
        lowStockThreshold: Number(row.threshold ?? 0),
        sold: Number(row.sold ?? 0),
        returned: Number(row.returned ?? 0),
      }));

      // Ties broken by nothing in particular, because a tie between two variants
      // has no better answer than the first of them.
      const best = variants.reduce<(typeof variants)[number] | null>(
        (leader, row) => (leader === null || row.sold > leader.sold ? row : leader),
        null,
      );

      return ok(reply, {
        currency: product.currency ?? 'USD',
        range: { days: query.days, timezone: product.timezone ?? 'UTC' },

        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          status: product.status,
          type: product.type,
          imageUrl: product.image_url,
          videoUrl: product.video_url,
          sku: product.sku,
          barcode: product.barcode,
          /*
           * The tree is read the way the panel files a product: when the chosen
           * category has a parent, the parent is the category and the chosen one
           * is the subcategory. A top-level product has no subcategory rather
           * than an empty one.
           */
          category: product.parent_category_id
            ? { id: product.parent_category_id, name: product.parent_category_name }
            : product.category_id
              ? { id: product.category_id, name: product.category_name }
              : null,
          subcategory: product.parent_category_id
            ? { id: product.category_id, name: product.category_name }
            : null,
          brand: product.brand_id ? { id: product.brand_id, name: product.brand_name } : null,
          price: product.price_from,
          salePrice: product.sale_price_from,
          costPrice: product.cost_price,
          trackInventory: product.track_inventory,
          isFeatured: product.is_featured,
          isNewArrival: product.is_new_arrival,
          isReturnable: product.is_returnable,
          variantCount: Number(stock?.variants ?? 0),
          publishedAt: product.published_at ? new Date(product.published_at).toISOString() : null,
          createdAt: new Date(product.created_at).toISOString(),
          updatedAt: new Date(product.updated_at).toISOString(),
        },

        stock: {
          received: Number(ledger?.received ?? 0),
          available,
          reserved: Number(stock?.reserved ?? 0),
          returnPending: Number(stock?.return_pending ?? 0),
          damaged: Number(stock?.damaged ?? 0),
          incoming: Number(stock?.incoming ?? 0),
          restocked: Number(ledger?.restocked ?? 0),
          writtenOff: Number(ledger?.written_off ?? 0),
          returned: returnedUnits,
          /** Dispatched. Moves on dispatch and nowhere else. */
          sold: Number(product.sold_count ?? 0),
          lowStockThreshold: threshold,
          /**
           * How many `inventory_levels` rows are behind the count. Zero means
           * nothing was ever recorded, which is a different problem from having
           * sold the last one — and the only way to tell them apart, since both
           * read as zero available.
           */
          stockRecords: levels,
          /*
           * `tracked` is the owner's switch; the three states below are what the
           * badge shows. A product that does not track stock is never out of it,
           * which is the whole point of the switch.
           */
          tracked: product.track_inventory,
          isUntracked: !product.track_inventory || levels === 0,
          isLow: product.track_inventory && levels > 0 && available > 0 && available <= threshold,
          isOut: product.track_inventory && levels > 0 && available <= 0,
        },

        money: {
          revenue: takings?.revenue ?? '0',
          discount: takings?.discount ?? '0',
          refunded: takings?.refunded ?? '0',
          /** Today's cost price applied to past sales — an estimate, not a ledger. */
          cost: takings?.cost ?? '0',
          estimatedProfit: (revenue - refunded - cost).toFixed(2),
          averageSellingPrice: soldUnits > 0 ? (revenue / soldUnits).toFixed(2) : null,
          /** Ordered, not dispatched — the basis the revenue beside it divides by. */
          units: soldUnits,
          orders: Number(takings?.orders ?? 0),
          unitCost: product.cost_price,
        },

        variants,

        movements: (movementResult.rows ?? []).map((row) => ({
          id: row.id,
          type: row.type,
          quantity: Number(row.quantity ?? 0),
          fromBucket: row.from_bucket,
          toBucket: row.to_bucket,
          availableAfter: Number(row.available_after ?? 0),
          reservedAfter: Number(row.reserved_after ?? 0),
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          /** Resolved when the reference is an order, so the row can link to it. */
          orderNumber: row.order_number,
          damageReason: row.damage_reason,
          note: row.note,
          adminLabel: row.admin_label,
          sku: row.sku,
          variantTitle: row.variant_title,
          createdAt: new Date(row.created_at).toISOString(),
        })),

        sales: {
          series,
          bestVariant: best && best.sold > 0 ? { id: best.id, sku: best.sku, title: best.title, sold: best.sold } : null,
        },

        returns: {
          requests: Number(returned?.requests ?? 0),
          units: returnedUnits,
          open: Number(returned?.open ?? 0),
          restocked: Number(returned?.restocked ?? 0),
          damaged: Number(returned?.damaged ?? 0),
          /** What the returned units were worth, on returns that completed. */
          value: returned?.value ?? '0',
          /**
           * Against units **ordered**, not dispatched: a return is only possible
           * on something that was bought, and dividing by dispatch would flatter
           * a shop with a backlog.
           */
          rate: soldUnits > 0 ? Number(((returnedUnits / soldUnits) * 100).toFixed(1)) : null,
        },

        activity: {
          wishlistCount: Number(activity?.wishlist ?? 0),
          reviewCount: Number(activity?.reviews_approved ?? 0),
          pendingReviews: Number(activity?.reviews_pending ?? 0),
          ratingAverage: Number(product.rating_average ?? 0),
          ratingCount: Number(product.rating_count ?? 0),
          viewCount: Number(product.view_count ?? 0),
        },
      });
    },
  );
}
