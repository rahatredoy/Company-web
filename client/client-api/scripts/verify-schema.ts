/**
 * Confirms a tenant database actually holds the commerce schema, and that the
 * guarantees which live in the database rather than in code are really there.
 *
 *   npx tsx scripts/verify-schema.ts [--slug abc-fashion]
 */
import { readdir } from 'node:fs/promises';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { COMMERCE_SCHEMA_VERSION } from '../src/db/tenant-migrate';
import { closeRedis } from '../src/lib/redis';

const slugArg = process.argv.indexOf('--slug');
const SLUG = slugArg > -1 ? process.argv[slugArg + 1]! : (config.devStoreSlug ?? 'abc-fashion');

const pool = await openTenantPoolForSlug(SLUG);

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

/** Tables the company platform owns. Losing one would orphan a provisioned store. */
const COMPANY_TABLES = ['store_settings', 'store_admins', 'platform_sync'];

const EXPECTED = [
  // catalog
  'categories', 'brands', 'attributes', 'attribute_values', 'products', 'product_variants',
  'product_variant_values', 'product_media', 'product_specifications', 'product_attribute_values',
  'product_bundles', 'collections', 'collection_products',
  // inventory
  'warehouses', 'inventory_levels', 'inventory_transactions',
  // customers
  'customers', 'customer_sessions', 'customer_tokens', 'customer_addresses', 'customer_stats',
  'back_in_stock_requests',
  // cart
  'carts', 'cart_items', 'wishlists', 'wishlist_items',
  // orders
  'orders', 'order_items', 'order_addresses', 'order_status_history',
  // money
  'payments', 'payment_webhook_events', 'payment_methods', 'shipping_zones', 'shipping_methods',
  'shipments', 'returns', 'return_items', 'return_attachments', 'return_history', 'refunds',
  // marketing
  'discounts', 'coupons', 'coupon_redemptions', 'flash_sales', 'flash_sale_products', 'reviews',
  'review_images', 'banners', 'newsletter_subscribers', 'contact_messages',
  // content
  'pages', 'faqs', 'homepage_sections', 'navigation_menus', 'navigation_items',
  // metrics
  'store_daily_metrics', 'product_daily_metrics', 'notification_templates', 'notification_logs',
];

async function main(): Promise<void> {
  console.log(`\nSchema verification — store “${SLUG}”\n`);

  const present = new Set(
    (await rows<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    )).map((r) => r.table_name),
  );

  console.log('1. Tables');
  const missing = EXPECTED.filter((t) => !present.has(t));
  check(`all ${EXPECTED.length} commerce tables exist`, missing.length === 0, missing);
  check('company-provisioned tables survived', COMPANY_TABLES.every((t) => present.has(t)));

  console.log('\n2. Schema version');
  const version = await rows<{ value: { version?: string } }>(
    `select value from platform_sync where key = 'commerce_schema_version'`,
  );
  check(
    `platform_sync reports ${COMMERCE_SCHEMA_VERSION}`,
    version[0]?.value?.version === COMMERCE_SCHEMA_VERSION,
    version[0]?.value,
  );

  /*
   * Counted against the migration folder rather than a literal.
   *
   * This read `=== '3'` and started failing the moment a fourth migration was
   * added — which is exactly when a check on "did every migration reach this
   * tenant" most needs to be working, and is the failure mode
   * `COMMERCE_SCHEMA_VERSION` exists to catch.
   */
  const expected = (await readdir(new URL('../drizzle/', import.meta.url))).filter((name) =>
    name.endsWith('.sql'),
  ).length;
  const applied = await rows<{ n: string }>(`select count(*)::text as n from drizzle.__drizzle_migrations`);
  check(
    `all ${expected} migrations recorded`,
    Number(applied[0]?.n ?? 0) === expected,
    { applied: applied[0]?.n, expected },
  );

  console.log('\n3. The provisioned admin is intact, and is the only one');
  const owner = await rows(`select email, role_key, account_status from store_admins order by created_at limit 1`);
  check('admin row intact', Boolean(owner[0]), owner[0]);

  const admins = await rows<{ n: string }>(`select count(*)::text as n from store_admins`);
  check('exactly one admin account', admins[0]?.n === '1', admins[0]);

  console.log('\n4. Guarantees that live in the database, not in code');

  // These are the constraints that hold when two requests race and application
  // code has already lost. Tested by trying to violate them directly.
  const [warehouse] = await rows<{ id: string }>(
    `insert into warehouses (name, code, is_default)
     values ('Verification', 'VERIFY-TMP', false)
     on conflict (code) do update set name = excluded.name
     returning id`,
  );

  const [product] = await rows<{ id: string }>(
    `insert into products (name, slug, type, status) values ('Schema probe', 'schema-probe-tmp', 'simple', 'draft')
     on conflict (slug) do update set name = excluded.name returning id`,
  );
  const [variant] = await rows<{ id: string }>(
    `insert into product_variants (product_id, sku, price) values ($1, 'VERIFY-TMP-SKU', '10.00')
     on conflict (sku) do update set price = excluded.price returning id`,
    [product!.id],
  );

  await pool.query(
    `insert into inventory_levels (variant_id, warehouse_id, available)
     values ($1, $2, 5) on conflict (variant_id, warehouse_id) do update set available = 5`,
    [variant!.id, warehouse!.id],
  );

  // Overselling: the conditional UPDATE the API uses must simply not match.
  const oversell = await pool.query(
    `update inventory_levels set available = available - 99
      where variant_id = $1 and warehouse_id = $2 and available >= 99 returning id`,
    [variant!.id, warehouse!.id],
  );
  check('a decrement larger than stock matches no row', oversell.rowCount === 0);

  // And if code ever bypassed the guard, the constraint still refuses.
  let negativeRefused = false;
  try {
    await pool.query(`update inventory_levels set available = -1 where variant_id = $1`, [variant!.id]);
  } catch (error) {
    negativeRefused = /available_check/.test((error as Error).message);
  }
  check('negative stock is refused by a CHECK constraint', negativeRefused);

  let badRating = false;
  try {
    await pool.query(
      `insert into reviews (product_id, customer_name, rating) values ($1, 'Probe', 9)`,
      [product!.id],
    );
  } catch (error) {
    badRating = /rating_check/.test((error as Error).message);
  }
  check('a rating outside 1–5 is refused', badRating);

  let badQuantity = false;
  try {
    await pool.query(
      `insert into carts (currency) values ('USD') returning id`,
    );
    const [cart] = await rows<{ id: string }>(`select id from carts order by created_at desc limit 1`);
    await pool.query(
      `insert into cart_items (cart_id, product_id, variant_id, quantity) values ($1, $2, $3, 0)`,
      [cart!.id, product!.id, variant!.id],
    );
  } catch (error) {
    badQuantity = /quantity_check/.test((error as Error).message);
  }
  check('a cart line with quantity 0 is refused', badQuantity);

  // A duplicate webhook delivery must collide rather than be processed twice.
  await pool.query(
    `insert into payment_webhook_events (provider, event_id) values ('mock', 'verify-tmp-evt')
     on conflict do nothing`,
  );
  const duplicate = await pool.query(
    `insert into payment_webhook_events (provider, event_id) values ('mock', 'verify-tmp-evt')
     on conflict do nothing returning id`,
  );
  check('a replayed webhook event id cannot insert twice', duplicate.rowCount === 0);

  // Clean up everything the probe created.
  await pool.query(`delete from payment_webhook_events where event_id = 'verify-tmp-evt'`);
  await pool.query(`delete from carts where id in (select cart_id from cart_items where variant_id = $1)`, [variant!.id]);
  await pool.query(`delete from carts where customer_id is null and token_hash is null`);
  await pool.query(`delete from products where slug = 'schema-probe-tmp'`);
  await pool.query(`delete from warehouses where code = 'VERIFY-TMP'`);

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error('\nverification crashed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
