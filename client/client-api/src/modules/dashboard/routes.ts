import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenantExecutor } from '../../db/tenant-manager';
import { ok, parseQuery } from '../../lib/http';
import { languageOf, translate } from '../../lib/i18n/index';
import type { Language } from '../../lib/languages';
import { loadStoreCurrency } from '../../lib/store-currency';
import { storeOf } from '../../plugins/tenant';

/**
 * Everything the panel's home screen shows, in one call, **section by section**.
 *
 * The screen is eight panels deep and every one of them is a different shape of
 * the same two tables. Answering it from eight endpoints would mean eight round
 * trips, eight sets of headers and eight chances for one slow query to hold up
 * the render — so this is deliberately a *screen endpoint* rather than a
 * resource: it exists to serve one page and its shape may change with it.
 *
 * What it does **not** do is let one panel take the screen down. Each section is
 * computed independently and reported as `{ ok: true, data }` or
 * `{ ok: false, reason }`, so a query that fails, or a section the signed-in
 * admin has no permission to read, costs exactly that panel. The response is
 * still a 200 — the page rendered, one card on it did not.
 *
 * Nothing here is cached. The panel is behind a session, `plugins/security.ts`
 * marks it `no-store`, and a shopkeeper looking at today's figures is the one
 * reader who must not be shown a minute-old number.
 */

const querySchema = z.object({
  /** The window, in whole store-local days, ending at the end of today. */
  days: z.coerce.number().int().min(1).max(365).default(7),
  /** How the sales chart buckets that window. The sparklines are always daily. */
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

/** How a `granularity` becomes the two things Postgres needs to bucket by it. */
const BUCKET = {
  day: { unit: 'day', step: '1 day' },
  week: { unit: 'week', step: '1 week' },
  month: { unit: 'month', step: '1 month' },
} as const;

/**
 * Orders that are neither cancelled nor failed — the ones that represent money.
 *
 * A cancelled order was never revenue, and counting it would make a bad week
 * look like a good one.
 */
const COUNTED = sql`o.status not in ('cancelled', 'failed')`;

/**
 * An order somebody still has to do something about, before it is on its way.
 *
 * Stops at `packed` on purpose: once a parcel is `shipped` the work has left the
 * building, so keeping it in the queue would mean the figure only ever grows.
 */
const AWAITING = sql`o.status in ('new', 'pending', 'confirmed', 'processing', 'packed')`;

/**
 * An order taken in the currency the store trades in now.
 *
 * Applied to money and never to counts. `orders.currency` is snapshotted at
 * checkout, so a store that has switched currency holds orders in both, and a
 * sum across them printed with one symbol is not a figure — while an order
 * count across them is still exactly how many orders there were.
 */
const inCurrency = (currency: string) => sql`o.currency = ${currency}`;

/**
 * The thumbnail for a product, resolved the way the catalogue list resolves it —
 * the variant's own picture first, the gallery second. A second, more optimistic
 * answer here would show the owner a picture their shoppers never see.
 */
const productImage = (productId: ReturnType<typeof sql>) => sql`coalesce(
  (select v.image_url from product_variants v
    where v.product_id = ${productId} and v.image_url is not null
    order by v.is_default desc, v.sort_order asc
    limit 1),
  (select m.url from product_media m
    where m.product_id = ${productId}
    order by m.is_primary desc, m.sort_order asc
    limit 1)
)`;

type Section<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'forbidden' | 'failed'; message: string };

/**
 * Runs one panel's queries and never throws.
 *
 * A failure is logged with its section name and returned as data, because the
 * alternative — letting it reject — takes the other seven panels with it. The
 * message is fixed text: a driver error can carry a query, and this one is bound
 * for a browser.
 */
async function section<T>(
  app: FastifyInstance,
  name: string,
  run: () => Promise<T>,
): Promise<Section<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    app.log.error({ err: error, section: name }, 'dashboard section failed');
    return { ok: false, reason: 'failed', message: 'This could not be loaded just now.' };
  }
}

const denied = (what: string): Section<never> => ({
  ok: false,
  reason: 'forbidden',
  message: `You do not have access to ${what}.`,
});

/**
 * A refused or broken section's message in the store's language. It travels
 * inside a 200, so the error handler — which translates every error — never
 * sees it. The data of a section that loaded is passed through untouched.
 */
function inLanguage<T>(result: Section<T>, language: Language): Section<T> {
  return result.ok ? result : { ...result, message: translate(language, result.message) };
}

interface BucketRow {
  bucket: string;
  orders: number;
  revenue: string;
  customers: number;
  awaiting: number;
}

/**
 * A gap-free series between two instants, bucketed in the **store's** timezone.
 *
 * Generated from a calendar rather than from the orders, so a day with no sales
 * is a zero rather than a missing point — a chart that closes the gap invents a
 * trend that never happened. The buckets are built in local time and converted
 * back, which is what keeps them on local midnight across a DST change.
 */
async function bucketedSeries(
  db: TenantExecutor,
  args: { from: Date; to: Date; tz: string; unit: string; step: string; currency: string },
): Promise<BucketRow[]> {
  const result = await db.execute<{
    bucket: string;
    orders: number;
    revenue: string;
    customers: number;
    awaiting: number;
  }>(sql`
    with slots as (
      select
        g.local_start,
        g.local_start at time zone ${args.tz} as starts_at,
        (g.local_start + ${args.step}::interval) at time zone ${args.tz} as ends_at
      from generate_series(
        date_trunc(${args.unit}, ${args.from}::timestamptz at time zone ${args.tz}),
        date_trunc(${args.unit}, (${args.to}::timestamptz - interval '1 second') at time zone ${args.tz}),
        ${args.step}::interval
      ) as g(local_start)
    )
    select
      to_char(s.local_start, 'YYYY-MM-DD') as bucket,
      count(o.id)::int as orders,
      coalesce(sum(o.grand_total) filter (where ${inCurrency(args.currency)}), 0)::numeric(14,2)::text as revenue,
      count(distinct o.customer_id)::int as customers,
      count(o.id) filter (where ${AWAITING})::int as awaiting
    from slots s
    left join orders o
      on o.placed_at >= s.starts_at
     and o.placed_at < s.ends_at
     and ${COUNTED}
    group by s.local_start
    order by s.local_start
  `);

  return (result.rows ?? []).map((row) => ({
    bucket: row.bucket,
    orders: Number(row.orders ?? 0),
    revenue: row.revenue ?? '0',
    customers: Number(row.customers ?? 0),
    awaiting: Number(row.awaiting ?? 0),
  }));
}

/**
 * A figure, what it was over the window before it, and the movement between.
 *
 * `changePct` is null rather than 0 when the previous window was empty: a store
 * that took its first order did not grow by 100%, it started, and a percentage
 * against nothing is a number with no meaning behind it.
 */
function delta(value: number, previous: number, spark: number[] = []) {
  return {
    value,
    previous,
    changePct: previous > 0 ? ((value - previous) / previous) * 100 : null,
    spark,
  };
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get(
    '/dashboard',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('dashboard.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const granted = request.storeAdmin!.permissions;
      const query = parseQuery(querySchema, request.query);

      /*
       * The window, decided by Postgres in the store's own timezone.
       *
       * A shopkeeper in Dhaka asking for "the last 7 days" means seven of their
       * days, not seven of the server's, and only the database knows what the
       * IANA name in `store_settings` means today. Resolved first so every query
       * below is bound to the same three instants — computing them per section
       * would let a request that straddles midnight report two different weeks.
       *
       * This one is allowed to throw. If the tenant database cannot answer a
       * single-row `now()`, there is no window to compute anything else against,
       * and the panel's own error state is a better answer than eight identical
       * failures.
       */
      const boundsQuery = store.db.execute<{
        tz: string;
        starts_at: Date;
        ends_at: Date;
        previous_starts_at: Date;
      }>(sql`
        with s as (select coalesce(min(timezone), 'UTC') as tz from store_settings)
        select
          s.tz as tz,
          (date_trunc('day', now() at time zone s.tz)
            - make_interval(days => ${query.days - 1})) at time zone s.tz as starts_at,
          (date_trunc('day', now() at time zone s.tz)
            + interval '1 day') at time zone s.tz as ends_at,
          (date_trunc('day', now() at time zone s.tz)
            - make_interval(days => ${query.days * 2 - 1})) at time zone s.tz as previous_starts_at
        from s
      `);

      /*
       * Read through the same cache as the session, so the currency every total
       * below is filtered by is the one the panel prints beside it — two readers
       * with two caches could disagree for a few seconds after a switch.
       */
      const [boundsResult, currency] = await Promise.all([boundsQuery, loadStoreCurrency(store)]);

      const bounds = boundsResult.rows?.[0];
      const tz = bounds?.tz ?? 'UTC';
      const from = new Date(bounds!.starts_at);
      const to = new Date(bounds!.ends_at);
      const previousFrom = new Date(bounds!.previous_starts_at);

      const canSeeOrders = granted.has('orders.view');
      const canSeeInventory = granted.has('inventory.view');
      const canSeeReviews = granted.has('reviews.view');

      /*
       * Daily buckets, shared by the sparklines and — when the chart is showing
       * days — by the chart. Best-effort on purpose: a KPI row is still worth
       * rendering without its trend lines, so a failure here empties the sparks
       * rather than failing the metrics section.
       */
      const daily = await bucketedSeries(store.db, { from, to, tz, unit: 'day', step: '1 day', currency }).catch(
        (error: unknown) => {
          app.log.error({ err: error, section: 'daily' }, 'dashboard section failed');
          return null;
        },
      );

      /*
       * `dashboard.view` opens the screen; it does not widen what the admin may
       * read. A panel they are barred from is refused by name rather than blanked
       * in the UI, so the figure never travels to a browser that should not have
       * it — and the page can say why instead of showing an empty card.
       */
      const [metrics, series, recentOrders, topProducts, lowStock, reviews] = await Promise.all([
        section(app, 'metrics', async () => {
          const [totals, customers, catalogue] = await Promise.all([
            store.db.execute<{
              orders: number;
              priced_orders: number;
              revenue: string;
              discounts: string;
              refunded: string;
              awaiting: number;
              previous_orders: number;
              previous_revenue: string;
              previous_awaiting: number;
            }>(sql`
              select
                count(*) filter (where o.placed_at >= ${from})::int as orders,
                count(*) filter (where o.placed_at >= ${from} and ${inCurrency(currency)})::int as priced_orders,
                coalesce(sum(o.grand_total) filter (where o.placed_at >= ${from} and ${inCurrency(currency)}), 0)::numeric(14,2)::text as revenue,
                coalesce(sum(o.discount_total) filter (where o.placed_at >= ${from} and ${inCurrency(currency)}), 0)::numeric(14,2)::text as discounts,
                coalesce(sum(o.refunded_total) filter (where o.placed_at >= ${from} and ${inCurrency(currency)}), 0)::numeric(14,2)::text as refunded,
                count(*) filter (where o.placed_at >= ${from} and ${AWAITING})::int as awaiting,
                count(*) filter (where o.placed_at < ${from})::int as previous_orders,
                coalesce(sum(o.grand_total) filter (where o.placed_at < ${from} and ${inCurrency(currency)}), 0)::numeric(14,2)::text as previous_revenue,
                count(*) filter (where o.placed_at < ${from} and ${AWAITING})::int as previous_awaiting
              from orders o
              where o.placed_at >= ${previousFrom} and o.placed_at < ${to} and ${COUNTED}
            `),

            store.db.execute<{ current: number; previous: number }>(sql`
              select
                count(*) filter (where c.created_at >= ${from})::int as current,
                count(*) filter (where c.created_at < ${from})::int as previous
              from customers c
              where c.created_at >= ${previousFrom} and c.created_at < ${to}
            `),

            store.db.execute<{ active: number; total: number }>(sql`
              select
                count(*) filter (where p.status = 'active')::int as active,
                count(*)::int as total
              from products p
            `),
          ]);

          const row = totals.rows?.[0];
          const customerRow = customers.rows?.[0];
          const catalogueRow = catalogue.rows?.[0];

          const revenue = Number(row?.revenue ?? 0);
          const orderCount = Number(row?.orders ?? 0);
          const pricedOrders = Number(row?.priced_orders ?? 0);

          return {
            revenue: delta(
              revenue,
              Number(row?.previous_revenue ?? 0),
              (daily ?? []).map((bucket) => Number(bucket.revenue)),
            ),
            orders: delta(
              orderCount,
              Number(row?.previous_orders ?? 0),
              (daily ?? []).map((bucket) => bucket.orders),
            ),
            /** Placed in this window and still waiting on somebody. A rise is bad. */
            pendingOrders: delta(
              Number(row?.awaiting ?? 0),
              Number(row?.previous_awaiting ?? 0),
              (daily ?? []).map((bucket) => bucket.awaiting),
            ),
            newCustomers: delta(
              Number(customerRow?.current ?? 0),
              Number(customerRow?.previous ?? 0),
              (daily ?? []).map((bucket) => bucket.customers),
            ),
            totals: {
              revenue: row?.revenue ?? '0',
              discounts: row?.discounts ?? '0',
              refunded: row?.refunded ?? '0',
              // Divided by the orders that revenue was summed over, not by every
              // order: an order in another currency added nothing to the top line.
              averageOrderValue: pricedOrders > 0 ? (revenue / pricedOrders).toFixed(2) : '0.00',
              activeProducts: Number(catalogueRow?.active ?? 0),
              totalProducts: Number(catalogueRow?.total ?? 0),
            },
          };
        }),

        section(app, 'series', async () => {
          const rows =
            query.granularity === 'day'
              ? (daily ?? (await bucketedSeries(store.db, { from, to, tz, unit: 'day', step: '1 day', currency })))
              : await bucketedSeries(store.db, { from, to, tz, currency, ...BUCKET[query.granularity] });

          return {
            granularity: query.granularity,
            points: rows.map((bucket) => ({
              bucket: bucket.bucket,
              orders: bucket.orders,
              revenue: bucket.revenue,
            })),
          };
        }),

        canSeeOrders
          ? section(app, 'recentOrders', async () => {
              const result = await store.db.execute<{
                id: string;
                order_number: string;
                customer_name: string;
                status: string;
                payment_status: string;
                currency: string;
                grand_total: string;
                item_count: number;
                placed_at: Date;
              }>(sql`
                select
                  o.id,
                  o.order_number,
                  o.customer_name,
                  o.status,
                  o.payment_status,
                  o.currency,
                  o.grand_total::text as grand_total,
                  (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as item_count,
                  o.placed_at
                from orders o
                order by o.placed_at desc
                limit 6
              `);

              return (result.rows ?? []).map((row) => ({
                id: row.id,
                orderNumber: row.order_number,
                customerName: row.customer_name,
                status: row.status,
                paymentStatus: row.payment_status,
                currency: row.currency,
                grandTotal: row.grand_total,
                itemCount: Number(row.item_count ?? 0),
                placedAt: new Date(row.placed_at).toISOString(),
              }));
            })
          : denied('orders'),

        canSeeOrders
          ? section(app, 'topProducts', async () => {
              const period = await store.db.execute<{
                product_id: string | null;
                name: string;
                units: number;
                revenue: string;
                image_url: string | null;
              }>(sql`
                select
                  i.product_id,
                  max(i.product_name) as name,
                  sum(i.quantity)::int as units,
                  coalesce(sum(i.line_total) filter (where ${inCurrency(currency)}), 0)::numeric(14,2)::text as revenue,
                  coalesce(${productImage(sql`i.product_id`)}, max(i.image_url)) as image_url
                from order_items i
                join orders o on o.id = i.order_id
                where o.placed_at >= ${from} and o.placed_at < ${to} and ${COUNTED}
                group by i.product_id
                order by sum(i.quantity) desc, max(i.product_name) asc
                limit 5
              `);

              const rows = period.rows ?? [];
              if (rows.length > 0) {
                return {
                  scope: 'period' as const,
                  products: rows.map((row) => ({
                    productId: row.product_id,
                    name: row.name,
                    imageUrl: row.image_url,
                    units: Number(row.units ?? 0),
                    revenue: row.revenue ?? '0',
                  })),
                };
              }

              /*
               * Nothing sold in this window, which for a shop that has been
               * trading for a while says more about the window than the shop. The
               * fallback is the catalogue's own lifetime `sold_count` — the figure
               * the order pipeline maintains on dispatch — labelled `all_time` so
               * the panel can say which it is showing rather than implying these
               * were this week's sales. Revenue is not carried across: `sold_count`
               * counts units, and what they were charged at is long gone.
               */
              const lifetime = await store.db.execute<{
                product_id: string;
                name: string;
                units: number;
                image_url: string | null;
              }>(sql`
                select
                  p.id as product_id,
                  p.name,
                  p.sold_count::int as units,
                  ${productImage(sql`p.id`)} as image_url
                from products p
                where p.sold_count > 0
                order by p.sold_count desc, p.name asc
                limit 5
              `);

              return {
                scope: 'all_time' as const,
                products: (lifetime.rows ?? []).map((row) => ({
                  productId: row.product_id,
                  name: row.name,
                  imageUrl: row.image_url,
                  units: Number(row.units ?? 0),
                  revenue: null,
                })),
              };
            })
          : denied('orders'),

        canSeeInventory
          ? section(app, 'lowStock', async () => {
              /*
               * Counted per **variant**, not per level row. A variant stocked in
               * three warehouses has three rows, and counting those would report
               * one low product as three — while summing them is what decides
               * whether the shop can actually still sell the thing.
               */
              const [tally, rows] = await Promise.all([
                store.db.execute<{ low: number; out: number; tracked: number }>(sql`
                  select
                    count(*) filter (where t.available <= t.threshold)::int as low,
                    count(*) filter (where t.available <= 0)::int as out,
                    count(*)::int as tracked
                  from (
                    select
                      sum(l.available)::int as available,
                      max(l.low_stock_threshold)::int as threshold
                    from inventory_levels l
                    group by l.variant_id
                  ) t
                `),

                store.db.execute<{
                  variant_id: string;
                  product_id: string;
                  product_name: string;
                  variant_title: string | null;
                  sku: string;
                  image_url: string | null;
                  available: number;
                  reserved: number;
                  incoming: number;
                  threshold: number;
                }>(sql`
                  select
                    v.id as variant_id,
                    p.id as product_id,
                    p.name as product_name,
                    v.title as variant_title,
                    v.sku,
                    coalesce(v.image_url, ${productImage(sql`p.id`)}) as image_url,
                    sum(l.available)::int as available,
                    sum(l.reserved)::int as reserved,
                    sum(l.incoming)::int as incoming,
                    max(l.low_stock_threshold)::int as threshold
                  from inventory_levels l
                  join product_variants v on v.id = l.variant_id
                  join products p on p.id = v.product_id
                  group by v.id, p.id, p.name, v.title, v.sku, v.image_url
                  having sum(l.available) <= max(l.low_stock_threshold)
                  order by sum(l.available) asc, p.name asc
                  limit 5
                `),
              ]);

              const counts = tally.rows?.[0];

              return {
                low: Number(counts?.low ?? 0),
                out: Number(counts?.out ?? 0),
                tracked: Number(counts?.tracked ?? 0),
                items: (rows.rows ?? []).map((row) => ({
                  variantId: row.variant_id,
                  productId: row.product_id,
                  productName: row.product_name,
                  variantTitle: row.variant_title,
                  sku: row.sku,
                  imageUrl: row.image_url,
                  available: Number(row.available ?? 0),
                  reserved: Number(row.reserved ?? 0),
                  incoming: Number(row.incoming ?? 0),
                  threshold: Number(row.threshold ?? 0),
                })),
              };
            })
          : denied('inventory'),

        canSeeReviews
          ? section(app, 'reviews', async () => {
              const result = await store.db.execute<{ pending: number }>(
                sql`select count(*)::int as pending from reviews where status = 'pending'`,
              );
              return { pending: Number(result.rows?.[0]?.pending ?? 0) };
            })
          : denied('reviews'),
      ]);

      const language = await languageOf(request);

      return ok(reply, {
        range: {
          days: query.days,
          granularity: query.granularity,
          timezone: tz,
          from: from.toISOString(),
          /** Exclusive — the instant the window ends, not its last second. */
          to: to.toISOString(),
          previousFrom: previousFrom.toISOString(),
          previousTo: from.toISOString(),
        },
        /** What every total above is in — and the only currency they add up. */
        currency,
        sections: {
          metrics: inLanguage(metrics, language),
          series: inLanguage(series, language),
          recentOrders: inLanguage(recentOrders, language),
          topProducts: inLanguage(topProducts, language),
          lowStock: inLanguage(lowStock, language),
          reviews: inLanguage(reviews, language),
        },
      });
    },
  );
}
