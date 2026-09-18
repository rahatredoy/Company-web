/**
 * Gives the Returns screen something to show.
 *
 *   npx tsx scripts/seed-demo-returns.ts                 # the dev store
 *   npx tsx scripts/seed-demo-returns.ts --slug e-comarch
 *   npx tsx scripts/seed-demo-returns.ts --reset         # remove what a previous run added
 *
 * A return needs a delivered order and a customer behind it, and a demo store
 * has neither — so this writes a handful of customers, delivered orders against
 * real catalogue products, and one return in every status the screen draws,
 * plus the refunds the finished ones raised.
 *
 * Written straight into the tables, unlike `seed-demo-store.ts`: returns only
 * ever come from customers, and delivered orders only ever come from a checkout
 * followed by a fulfilment nobody can drive from a script. It deliberately moves
 * **no stock** — these orders never reserved any, so restocking a return would
 * put units on the shelf that were never taken off it.
 *
 * Everything added is findable again: customers on `@demo-returns.test`, orders
 * tagged `metadata.demo = 'returns'`. Re-running removes the previous set first.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug;
const RESET = process.argv.includes('--reset');
const DOMAIN = 'demo-returns.test';

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}

const CUSTOMERS = [
  { name: 'Tanvir Hasan', phone: '01711234567', city: 'Dhaka', line: 'House 12, Road 5, Dhanmondi' },
  { name: 'Nusrat Jahan', phone: '01819876543', city: 'Chattogram', line: 'Flat 4B, GEC Circle' },
  { name: 'Rakib Ahmed', phone: '01912345678', city: 'Sylhet', line: 'Zindabazar, Lane 3' },
  { name: 'Farzana Akter', phone: '01556789012', city: 'Dhaka', line: 'Sector 7, Uttara' },
  { name: 'Mehedi Islam', phone: '01678901234', city: 'Khulna', line: 'KDA Avenue, House 22' },
  { name: 'Sadia Rahman', phone: '01398765432', city: 'Rajshahi', line: 'Shaheb Bazar, Road 2' },
];

type RefundPlan = { status: 'requested' | 'approved' | 'processing' | 'completed' | 'failed' | 'rejected' };

type ReturnPlan = {
  customer: number;
  products: number[];
  returnLines: number; // how many of the order's lines are returned
  status: 'requested' | 'under_review' | 'approved' | 'rejected' | 'received' | 'inspected' | 'completed';
  resolution: 'refund' | 'exchange' | 'replacement';
  reason: string;
  description: string;
  daysAgo: number;
  rejection?: string;
  inspection?: 'good' | 'damaged' | 'repairable' | 'rejected';
  refund?: RefundPlan;
  refundOnly?: boolean; // a refund with no return behind it
};

const PLANS: ReturnPlan[] = [
  { customer: 0, products: [2, 1], returnLines: 1, status: 'requested', resolution: 'exchange', reason: 'Wrong size', description: 'Ordered L but it fits like an S. Would like one size up.', daysAgo: 1 },
  { customer: 1, products: [3], returnLines: 1, status: 'requested', resolution: 'refund', reason: 'Item not as described', description: 'Noise cancelling is much weaker than advertised.', daysAgo: 2 },
  { customer: 2, products: [0, 4], returnLines: 1, status: 'under_review', resolution: 'refund', reason: 'Damaged on arrival', description: 'The tub lid was cracked and powder had spilled inside the box.', daysAgo: 3 },
  { customer: 3, products: [5], returnLines: 1, status: 'approved', resolution: 'replacement', reason: 'Defective item', description: 'Stops charging after a few minutes.', daysAgo: 5 },
  { customer: 4, products: [1, 6], returnLines: 2, status: 'rejected', resolution: 'refund', reason: 'Changed my mind', description: 'Found a cheaper one elsewhere.', daysAgo: 9, rejection: 'Item shows signs of use and the tags were removed.' },
  { customer: 5, products: [7], returnLines: 1, status: 'received', resolution: 'refund', reason: 'Wrong item sent', description: 'Received a different colour from the one I ordered.', daysAgo: 7 },
  { customer: 0, products: [8, 2], returnLines: 1, status: 'inspected', resolution: 'refund', reason: 'Defective item', description: 'Left side has no sound.', daysAgo: 11, inspection: 'damaged' },
  { customer: 1, products: [9], returnLines: 1, status: 'completed', resolution: 'refund', reason: 'Wrong size', description: 'Too small.', daysAgo: 16, inspection: 'good', refund: { status: 'completed' } },
  { customer: 3, products: [10, 0], returnLines: 2, status: 'completed', resolution: 'refund', reason: 'Item not as described', description: 'Material feels very different from the photos.', daysAgo: 20, inspection: 'good', refund: { status: 'processing' } },
  { customer: 2, products: [11], returnLines: 1, status: 'completed', resolution: 'refund', reason: 'Damaged on arrival', description: 'Screen was scratched out of the box.', daysAgo: 14, inspection: 'damaged', refund: { status: 'requested' } },
  { customer: 4, products: [4], returnLines: 1, status: 'completed', resolution: 'refund', reason: 'Late delivery', description: 'Arrived after the event I needed it for.', daysAgo: 25, inspection: 'good', refund: { status: 'failed' } },
  { customer: 5, products: [6, 3], returnLines: 0, status: 'completed', resolution: 'refund', reason: '', description: '', daysAgo: 6, refundOnly: true, refund: { status: 'approved' } },
];

const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000);
const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const money = (n: number) => n.toFixed(2);

const pool: any = await openTenantPoolForSlug(SLUG);
const client = await pool.connect();

try {
  await client.query('begin');

  // Remove a previous run. Returns and refunds cascade from their orders.
  const removed = await client.query(`delete from orders where metadata->>'demo' = 'returns'`);
  await client.query(`delete from customers where email like $1`, [`%@${DOMAIN}`]);
  console.log(`Removed ${removed.rowCount} demo orders from a previous run.`);

  if (RESET) {
    await client.query('commit');
    console.log('Reset done.');
  } else {
    const [{ currency }] = (await client.query(`select currency from store_settings limit 1`)).rows;
    const products = (
      await client.query(
        `select p.id, p.name, v.id as variant_id, v.sku, v.title, v.price,
                (select m.url from product_media m where m.product_id = p.id order by m.sort_order limit 1) as image
           from products p join product_variants v on v.product_id = p.id and v.is_default
          where p.status = 'active' and v.price is not null and p.sell_by <> 'measure'
          order by p.created_at limit 12`,
      )
    ).rows;
    if (products.length < 12) throw new Error(`Need 12 active products, found ${products.length}.`);

    const customerIds: string[] = [];
    for (const [i, c] of CUSTOMERS.entries()) {
      const email = `${c.name.toLowerCase().replace(/\s+/g, '.')}@${DOMAIN}`;
      const { rows } = await client.query(
        `insert into customers (email, full_name, phone, customer_type, email_verified_at, created_at, updated_at)
         values ($1, $2, $3, 'repeat', now(), $4, $4) returning id`,
        [email, c.name, c.phone, ago(60 + i * 5)],
      );
      customerIds.push(rows[0].id);
    }

    const seq = new Map<string, number>();
    const nextRef = async (prefix: string, table: string, column: string, at: Date) => {
      const day = stamp(at);
      const key = `${prefix}-${day}`;
      let n = seq.get(key) ?? 0;
      for (;;) {
        n += 1;
        const ref = `${key}-${String(n).padStart(4, '0')}`;
        const taken = await client.query(`select 1 from ${table} where ${column} = $1`, [ref]);
        if (taken.rowCount === 0) {
          seq.set(key, n);
          return ref;
        }
      }
    };

    let returnCount = 0;
    let refundCount = 0;

    for (const plan of PLANS) {
      const customer = CUSTOMERS[plan.customer];
      const customerId = customerIds[plan.customer];
      const placedAt = ago(plan.daysAgo + 8);
      const deliveredAt = ago(plan.daysAgo + 2);
      const requestedAt = ago(plan.daysAgo);

      // --- the delivered order ------------------------------------------------
      const lines = plan.products.map((p, i) => {
        const product = products[p];
        const quantity = i === 0 && plan.products.length === 1 ? 2 : 1;
        const unit = Number(product.price);
        return { product, quantity, unit, total: unit * quantity };
      });
      const subtotal = lines.reduce((s, l) => s + l.total, 0);

      const orderId = randomUUID();
      const orderNumber = await nextRef('ORD', 'orders', 'order_number', placedAt);
      await client.query(
        `insert into orders (id, order_number, customer_id, email, phone, customer_name, status, payment_status,
                             currency, subtotal, discount_total, tax_total, grand_total, payment_provider,
                             payment_method_label, placed_at, confirmed_at, shipped_at, delivered_at,
                             metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,'delivered','paid',$7,$8,0,0,$8,'cod','Cash on delivery',
                 $9,$10,$11,$12,'{"demo":"returns"}',$9,$12)`,
        [
          orderId, orderNumber, customerId,
          `${customer.name.toLowerCase().replace(/\s+/g, '.')}@${DOMAIN}`, customer.phone, customer.name,
          currency, money(subtotal), placedAt, ago(plan.daysAgo + 7), ago(plan.daysAgo + 5), deliveredAt,
        ],
      );
      await client.query(
        `insert into order_addresses (order_id, type, full_name, phone, address_line1, city, country)
         values ($1, 'shipping', $2, $3, $4, $5, 'Bangladesh')`,
        [orderId, customer.name, customer.phone, customer.line, customer.city],
      );
      const history: [string | null, string, Date, string][] = [
        [null, 'pending', placedAt, 'Order placed'],
        ['pending', 'confirmed', ago(plan.daysAgo + 7), 'Order confirmed'],
        ['confirmed', 'shipped', ago(plan.daysAgo + 5), 'Handed to courier'],
        ['shipped', 'delivered', deliveredAt, 'Delivered'],
      ];
      for (const [from, to, at, note] of history) {
        await client.query(
          `insert into order_status_history (order_id, from_status, to_status, note, created_at) values ($1,$2,$3,$4,$5)`,
          [orderId, from, to, note, at],
        );
      }
      const paymentId = randomUUID();
      await client.query(
        `insert into payments (id, order_id, provider, status, amount, currency, paid_at, created_at, updated_at)
         values ($1, $2, 'cod', 'paid', $3, $4, $5, $6, $5)`,
        [paymentId, orderId, money(subtotal), currency, deliveredAt, placedAt],
      );

      const itemIds: string[] = [];
      for (const line of lines) {
        const { rows } = await client.query(
          `insert into order_items (order_id, product_id, variant_id, product_name, variant_title, sku, image_url,
                                    unit_price, quantity, line_discount, line_tax, line_total, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,$11) returning id`,
          [
            orderId, line.product.id, line.product.variant_id, line.product.name, line.product.title,
            line.product.sku, line.product.image, money(line.unit), line.quantity, money(line.total), placedAt,
          ],
        );
        itemIds.push(rows[0].id);
      }

      // --- the return ---------------------------------------------------------
      let returnId: string | null = null;
      let refundable = 0;

      if (!plan.refundOnly) {
        const returned = lines.slice(0, plan.returnLines);
        refundable = returned.reduce((s, l) => s + l.total, 0);
        const flow = ['requested', 'under_review', 'approved', 'received', 'inspected', 'completed'];
        const reached = plan.status === 'rejected' ? ['requested', 'under_review', 'rejected'] : flow.slice(0, flow.indexOf(plan.status) + 1);
        const stepAt = (i: number) => new Date(requestedAt.getTime() + i * 26 * 3_600_000);
        const atOf = (s: string) => (reached.includes(s) ? stepAt(reached.indexOf(s)) : null);

        returnId = randomUUID();
        const returnNumber = await nextRef('RET', 'returns', 'return_number', requestedAt);
        const updatedAt = stepAt(reached.length - 1);
        await client.query(
          `insert into returns (id, return_number, order_id, customer_id, status, resolution, reason, description,
                                refundable_amount, reviewed_at, rejection_reason, received_at, completed_at,
                                admin_note, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            returnId, returnNumber, orderId, customerId, plan.status, plan.resolution, plan.reason, plan.description,
            money(plan.status === 'rejected' ? 0 : refundable),
            atOf('approved') ?? atOf('rejected'), plan.rejection ?? null, atOf('received'), atOf('completed'),
            plan.status === 'inspected' ? 'Waiting on the supplier before deciding.' : null,
            requestedAt, updatedAt,
          ],
        );
        for (const [i, s] of reached.entries()) {
          await client.query(
            `insert into return_history (return_id, from_status, to_status, note, admin_label, created_at)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              returnId, i === 0 ? null : reached[i - 1], s,
              i === 0 ? plan.reason : s === 'rejected' ? plan.rejection : null,
              i === 0 ? null : 'Store admin', stepAt(i),
            ],
          );
        }
        for (const [i, line] of returned.entries()) {
          const inspected = plan.inspection && atOf('inspected');
          await client.query(
            `insert into return_items (return_id, order_item_id, quantity, unit_price, line_total,
                                       inspection_result, inspection_note, restocked_quantity)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              returnId, itemIds[i], line.quantity, money(line.unit), money(line.total),
              inspected ? plan.inspection : null,
              inspected ? (plan.inspection === 'good' ? 'Unused, original packaging.' : 'Visible damage, written off.') : null,
              // No stock is moved by this script, so nothing is recorded as restocked.
              0,
            ],
          );
          if (plan.status !== 'rejected') {
            await client.query(`update order_items set returned_quantity = quantity where id = $1`, [itemIds[i]]);
          }
        }
        returnCount += 1;
      }

      // --- the refund ---------------------------------------------------------
      if (plan.refund) {
        const amount = plan.refundOnly ? lines[0].total : refundable;
        const createdAt = plan.refundOnly ? requestedAt : ago(plan.daysAgo - 6 < 0 ? 0 : plan.daysAgo - 6);
        const refundNumber = await nextRef('REF', 'refunds', 'refund_number', createdAt);
        const s = plan.refund.status;
        const approved = ['approved', 'processing', 'completed', 'failed'].includes(s);
        await client.query(
          `insert into refunds (refund_number, order_id, return_id, customer_id, payment_id, status, amount, currency,
                                reason, method, provider_reference, failure_reason, approved_at, completed_at,
                                created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
          [
            refundNumber, orderId, returnId, customerId, paymentId, s, money(amount), currency,
            plan.refundOnly ? 'Goodwill refund — item arrived late' : 'Return completed',
            approved ? (plan.refundOnly ? 'store_credit' : 'bkash') : null,
            s === 'completed' ? `BKS${Math.floor(Math.random() * 1e9)}` : null,
            s === 'failed' ? 'Wallet number could not be reached.' : null,
            approved ? createdAt : null,
            s === 'completed' ? createdAt : null,
            createdAt,
          ],
        );
        if (s === 'completed') {
          const partial = amount < subtotal;
          await client.query(
            `update orders set refunded_total = $2, payment_status = $3 where id = $1`,
            [orderId, money(amount), partial ? 'partially_refunded' : 'refunded'],
          );
          await client.query(`update payments set refunded_amount = $2 where id = $1`, [paymentId, money(amount)]);
        }
        refundCount += 1;
      }
    }

    await client.query('commit');
    console.log(`Seeded ${CUSTOMERS.length} customers, ${PLANS.length} delivered orders, ${returnCount} returns, ${refundCount} refunds on ${SLUG}.`);
  }
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await closeRedis().catch(() => {});
  process.exit(0);
}
