/**
 * Fills a store with a catalogue worth looking at.
 *
 *   npx tsx scripts/seed-demo-store.ts --slug e-comarch --email you@store.com --password '…'
 *   npx tsx scripts/seed-demo-store.ts --password '…'          # the dev store
 *   npx tsx scripts/seed-demo-store.ts --password '…' --reset  # remove what a previous run made
 *
 * A newly provisioned store gets navigation, policy pages, a payment method and
 * a shipping method — everything except anything to *sell*. So the storefront
 * renders correctly and looks empty, which is indistinguishable from broken when
 * you are trying to build against it.
 *
 * Everything here goes through the real admin API rather than SQL: slugs are
 * derived by the same code a form would use, stock moves through the same
 * conditional UPDATE and leaves the same ledger rows, and the storefront cache is
 * invalidated by the same hook. Seeding straight into the tables would produce
 * data the application itself would never have written.
 *
 * Images come from picsum.photos on a fixed seed, so a product keeps the same
 * picture between runs and nothing here needs an upload or a bucket.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug;
const EMAIL = arg('email');
const PASSWORD = arg('password');
const RESET = process.argv.includes('--reset');

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('Pass the store admin password: --password "…" (and --email if it is not the only admin).');
  process.exit(1);
}

const jar = new Map<string, string>();

/**
 * `node:http` rather than `fetch`, for the same reason the verification scripts
 * use it: `fetch` drops a custom `Host`, and the hostname is the entire tenant
 * identity mechanism.
 */
async function call(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(payload ? { 'content-type': 'application/json' } : {}),
  };
  if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  const result = await new Promise<{ status: number; setCookie: string[]; text: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: config.api.port,
          path: `/api/v1/admin${path}`,
          method: init.method ?? 'GET',
          headers: { ...headers, host: `admin.${SLUG}.${config.urls.platformRootDomain}` },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              setCookie: response.headers['set-cookie'] ?? [],
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    },
  );

  for (const cookie of result.setCookie) {
    const [pair] = cookie.split(';');
    const index = (pair ?? '').indexOf('=');
    if (index > 0) jar.set(pair!.slice(0, index).trim(), pair!.slice(index + 1));
  }

  let body: unknown = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    body = result.text;
  }

  return { status: result.status, body };
}

const image = (seed: string, size = 900) => `https://picsum.photos/seed/${seed}/${size}/${size}`;

// ------------------------------------------------------------------ data ----

const CATEGORIES = [
  { key: 'phones', name: 'Phones & Tablets' },
  { key: 'laptops', name: 'Laptops & Computers' },
  { key: 'audio', name: 'Audio & Headphones' },
  { key: 'wearables', name: 'Watches & Wearables' },
  { key: 'home', name: 'Smart Home' },
  { key: 'accessories', name: 'Accessories' },
];

const BRANDS = [
  { key: 'nexora', name: 'Nexora' },
  { key: 'lumen', name: 'Lumen Audio' },
  { key: 'vantage', name: 'Vantage' },
  { key: 'kestrel', name: 'Kestrel' },
  { key: 'orbit', name: 'Orbit Labs' },
];

interface DemoProduct {
  name: string;
  category: string;
  brand: string;
  price: string;
  salePrice?: string;
  cost: string;
  stock: number;
  featured?: boolean;
  newArrival?: boolean;
  short: string;
  description: string;
}

const PRODUCTS: DemoProduct[] = [
  {
    name: 'Nexora Pulse 12 Pro',
    category: 'phones', brand: 'nexora', price: '899.00', salePrice: '799.00', cost: '610.00',
    stock: 24, featured: true, newArrival: true,
    short: '6.7" OLED, 200MP camera, 5000mAh battery.',
    description:
      '<p>The Pulse 12 Pro pairs a 6.7-inch 120Hz OLED panel with a 200MP main sensor and a 5000mAh cell that comfortably clears a day.</p><ul><li>6.7" LTPO OLED, 120Hz</li><li>200MP main + 50MP ultrawide</li><li>5000mAh, 80W wired charging</li><li>Five years of security updates</li></ul>',
  },
  {
    name: 'Nexora Pulse 12',
    category: 'phones', brand: 'nexora', price: '649.00', cost: '445.00',
    stock: 38, newArrival: true,
    short: '6.4" OLED, 108MP camera, all-day battery.',
    description: '<p>Everything that makes the Pro worth carrying, in a frame small enough to use one-handed.</p>',
  },
  {
    name: 'Kestrel Note Tab 11',
    category: 'phones', brand: 'kestrel', price: '389.00', salePrice: '329.00', cost: '250.00',
    stock: 17,
    short: '11" 2K display with a pen in the box.',
    description: '<p>An 11-inch 2K tablet for reading, marking up and sketching. The pen is included, not an upsell.</p>',
  },
  {
    name: 'Vantage Studio 14',
    category: 'laptops', brand: 'vantage', price: '1499.00', cost: '1080.00',
    stock: 9, featured: true,
    short: '14" laptop, 32GB RAM, 1TB SSD.',
    description:
      '<p>A 14-inch machine built for work that does not stop: 32GB of memory, a 1TB drive and a chassis that stays quiet under load.</p><ul><li>14" 3K, 120Hz</li><li>32GB LPDDR5 · 1TB NVMe</li><li>18-hour rated battery</li></ul>',
  },
  {
    name: 'Vantage Book Air 13',
    category: 'laptops', brand: 'vantage', price: '999.00', salePrice: '899.00', cost: '705.00',
    stock: 21, newArrival: true,
    short: '1.1kg, fanless, 16GB RAM.',
    description: '<p>Fanless and 1.1kg, so it disappears into a bag and never makes a sound in a meeting.</p>',
  },
  {
    name: 'Orbit Mini PC M2',
    category: 'laptops', brand: 'orbit', price: '549.00', cost: '380.00',
    stock: 14,
    short: 'Palm-sized desktop, 16GB / 512GB.',
    description: '<p>A desktop the size of a paperback. Two HDMI outputs, four USB ports and no noise.</p>',
  },
  {
    name: 'Lumen Aria Over-Ear',
    category: 'audio', brand: 'lumen', price: '349.00', salePrice: '279.00', cost: '190.00',
    stock: 42, featured: true,
    short: 'Adaptive noise cancelling, 40-hour battery.',
    description:
      '<p>Adaptive cancellation that reads the room rather than one fixed profile, and 40 hours between charges.</p><ul><li>40mm drivers</li><li>Multipoint pairing</li><li>USB-C, 5-minute quick charge</li></ul>',
  },
  {
    name: 'Lumen Drift Earbuds',
    category: 'audio', brand: 'lumen', price: '179.00', cost: '96.00',
    stock: 65, newArrival: true,
    short: 'In-ear ANC, 8 + 24 hours.',
    description: '<p>Eight hours in the ear and another twenty-four in the case, with cancellation that holds up on a train.</p>',
  },
  {
    name: 'Lumen Hearth Speaker',
    category: 'audio', brand: 'lumen', price: '229.00', cost: '140.00',
    stock: 28,
    short: 'Room-filling 360° sound.',
    description: '<p>A 360-degree driver array that fills a room from a corner, which is where a speaker usually ends up.</p>',
  },
  {
    name: 'Kestrel Trace Watch 3',
    category: 'wearables', brand: 'kestrel', price: '299.00', salePrice: '249.00', cost: '165.00',
    stock: 31, featured: true,
    short: 'AMOLED, GPS, 10-day battery.',
    description: '<p>Ten days of battery with the always-on display left on, plus dual-band GPS that holds a fix under cover.</p>',
  },
  {
    name: 'Kestrel Trace Band',
    category: 'wearables', brand: 'kestrel', price: '89.00', cost: '44.00',
    stock: 88,
    short: 'Sleep and heart-rate tracking, 14 days.',
    description: '<p>A band that lasts a fortnight and tells you something useful about how you slept.</p>',
  },
  {
    name: 'Orbit Halo Smart Bulb (4-pack)',
    category: 'home', brand: 'orbit', price: '59.00', salePrice: '44.00', cost: '26.00',
    stock: 120,
    short: '16M colours, no hub needed.',
    description: '<p>Four bulbs, sixteen million colours and no hub to plug in anywhere.</p>',
  },
  {
    name: 'Orbit Sentry Indoor Camera',
    category: 'home', brand: 'orbit', price: '129.00', cost: '72.00',
    stock: 46, newArrival: true,
    short: '2K, local recording, privacy shutter.',
    description: '<p>2K recording to a card in the camera, and a shutter that physically covers the lens when you are home.</p>',
  },
  {
    name: 'Orbit Thermo Hub',
    category: 'home', brand: 'orbit', price: '199.00', cost: '118.00',
    stock: 19,
    short: 'Learns your week, cuts the bill.',
    description: '<p>Learns the shape of your week and stops heating an empty house.</p>',
  },
  {
    name: 'Nexora 100W GaN Charger',
    category: 'accessories', brand: 'nexora', price: '69.00', salePrice: '54.00', cost: '31.00',
    stock: 150,
    short: 'Four ports, laptop-capable.',
    description: '<p>One brick for the laptop, the phone, the watch and the earbuds, in a body smaller than the one that came with the laptop.</p>',
  },
  {
    name: 'Vantage Leather Sleeve 14"',
    category: 'accessories', brand: 'vantage', price: '79.00', cost: '38.00',
    stock: 54,
    short: 'Full-grain leather, wool lining.',
    description: '<p>Full-grain leather outside, wool inside, and it wears in rather than out.</p>',
  },
  {
    name: 'Kestrel Everyday Backpack 22L',
    category: 'accessories', brand: 'kestrel', price: '119.00', cost: '58.00',
    stock: 37, featured: true,
    short: 'Fits a 16" laptop, water-resistant.',
    description: '<p>Twenty-two litres, a padded 16-inch laptop pocket and a weatherproof shell for the walk from the car.</p>',
  },
  {
    name: 'Lumen Desk Stand Pro',
    category: 'accessories', brand: 'lumen', price: '99.00', cost: '47.00',
    stock: 0,
    short: 'Aluminium, height-adjustable.',
    description: '<p>Solid aluminium, adjusts with one hand and does not wobble when you type.</p>',
  },
];

const BANNERS = [
  {
    title: 'New season, new hardware',
    subtitle: 'Up to 20% off the Pulse 12 range',
    imageUrl: image('ecomarch-hero-1', 1600),
    linkUrl: '/category/phones-tablets',
    buttonLabel: 'Shop phones',
    position: 'home_hero' as const,
    sortOrder: 10,
  },
  {
    title: 'Sound that disappears',
    subtitle: 'Lumen Aria — now 279.00',
    imageUrl: image('ecomarch-hero-2', 1600),
    linkUrl: '/category/audio-headphones',
    buttonLabel: 'Listen closer',
    position: 'home_hero' as const,
    sortOrder: 20,
  },
  {
    title: 'Free delivery over 100.00',
    subtitle: 'Dispatched within one working day',
    imageUrl: image('ecomarch-promo-1', 1200),
    linkUrl: '/shop',
    buttonLabel: 'Browse everything',
    position: 'home_promo' as const,
    sortOrder: 10,
  },
];

const COUPONS = [
  {
    code: 'WELCOME10',
    description: '10% off a first order',
    type: 'percentage' as const,
    value: '10.00',
    maxDiscountAmount: '100.00',
    minOrderAmount: '50.00',
    usageLimit: 500,
    perCustomerLimit: 1,
    status: 'active' as const,
  },
  {
    code: 'FREESHIP',
    description: 'Free delivery, any basket',
    type: 'free_shipping' as const,
    value: '0.00',
    status: 'active' as const,
  },
  {
    code: 'SAVE25',
    description: '25.00 off orders over 200.00',
    type: 'fixed' as const,
    value: '25.00',
    minOrderAmount: '200.00',
    usageLimit: 200,
    status: 'active' as const,
  },
];

// ------------------------------------------------------------------ run ----

let created = 0;
let skipped = 0;

function report(label: string, status: number, body: unknown): boolean {
  if (status === 200 || status === 201) {
    created += 1;
    console.log(`  ok      ${label}`);
    return true;
  }
  // A second run hits the same names; that is not a failure worth stopping for.
  const code = (body as { code?: string } | null)?.code;
  if (status === 409 || code === 'SLUG_TAKEN' || code === 'SKU_TAKEN' || code === 'CODE_TAKEN') {
    skipped += 1;
    console.log(`  exists  ${label}`);
    return false;
  }
  console.log(`  FAILED  ${label} — ${status} ${JSON.stringify(body)}`);
  return false;
}

async function main(): Promise<void> {
  console.log(`\nSeeding ${SLUG} through the admin API on port ${config.api.port}\n`);

  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  if (login.status !== 200) {
    console.error(`  Could not sign in: ${JSON.stringify(login.body)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  signed in as ${login.body?.data?.admin?.email ?? EMAIL ?? '(the only admin)'}\n`);

  if (RESET) {
    console.log('Removing everything a previous run created…');
    for (const path of ['/products', '/categories', '/brands', '/banners', '/coupons']) {
      const list = await call(`${path}?pageSize=100`);
      const rows: Array<{ id: string; name?: string; code?: string; title?: string }> =
        list.body?.data ?? [];
      for (const row of rows) {
        const gone = await call(`${path}/${row.id}`, { method: 'DELETE' });
        console.log(
          `  ${gone.status === 204 || gone.status === 200 ? 'removed ' : 'kept    '}` +
            `${path.slice(1)} ${row.name ?? row.code ?? row.title ?? row.id}`,
        );
      }
    }
    console.log('');
  }

  /**
   * Creates a row only if one of that name is not already there.
   *
   * Necessary because a repeat run is otherwise not a no-op: only products
   * collide (on SKU). A category, brand or banner of an existing name is
   * perfectly legal — the API just derives a suffixed slug — so running twice
   * without this check silently doubles the catalogue's taxonomy.
   */
  async function ensure(
    path: string,
    identity: string,
    label: string,
    body: Record<string, unknown>,
  ): Promise<string | null> {
    const existing = await call(`${path}?pageSize=100`);
    const match = ((existing.body?.data ?? []) as Array<Record<string, unknown>>).find(
      (row) => String(row[identity] ?? '').trim() === String(body[identity] ?? '').trim(),
    );

    if (match) {
      skipped += 1;
      console.log(`  exists  ${label}`);
      return String(match.id);
    }

    const result = await call(path, { method: 'POST', body });
    return report(label, result.status, result.body) ? String(result.body.data.id) : null;
  }

  // ---- taxonomy -----------------------------------------------------------
  console.log('Categories');
  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    const id = await ensure('/categories', 'name', category.name, {
      name: category.name,
      imageUrl: image(`cat-${category.key}`, 600),
      isActive: true,
    });
    if (id) categoryIds.set(category.key, id);
  }

  console.log('\nBrands');
  const brandIds = new Map<string, string>();
  for (const brand of BRANDS) {
    const id = await ensure('/brands', 'name', brand.name, {
      name: brand.name,
      logoUrl: image(`brand-${brand.key}`, 400),
      isActive: true,
    });
    if (id) brandIds.set(brand.key, id);
  }

  // ---- catalogue ----------------------------------------------------------
  console.log('\nProducts');
  const warehouses = await call('/warehouses');
  const warehouseId = (warehouses.body?.data ?? [])[0]?.id as string | undefined;

  for (const [index, product] of PRODUCTS.entries()) {
    const sku = `ECM-${String(index + 1).padStart(3, '0')}`;
    const result = await call('/products', {
      method: 'POST',
      body: {
        name: product.name,
        sku,
        price: product.price,
        salePrice: product.salePrice ?? null,
        costPrice: product.cost,
        status: 'active',
        categoryId: categoryIds.get(product.category) ?? null,
        brandId: brandIds.get(product.brand) ?? null,
        shortDescription: product.short,
        description: product.description,
        imageUrl: image(`prod-${sku.toLowerCase()}`),
        isFeatured: product.featured ?? false,
        isNewArrival: product.newArrival ?? false,
        seoTitle: `${product.name} — ${product.short}`,
        seoDescription: product.short,
      },
    });

    if (!report(`${product.name}  (${sku})`, result.status, result.body)) continue;

    // Stock moves through the real endpoint, so it writes an
    // `inventory_transactions` row exactly as an adjustment from the panel does.
    const variantId = result.body?.data?.defaultVariant?.id as string | undefined;
    if (variantId && warehouseId && product.stock > 0) {
      const stocked = await call('/inventory/adjust', {
        method: 'POST',
        body: {
          variantId,
          warehouseId,
          bucket: 'available',
          delta: product.stock,
          reason: 'Opening stock (demo seed)',
          lowStockThreshold: 5,
        },
      });
      if (stocked.status !== 200 && stocked.status !== 201) {
        console.log(`          stock not set — ${stocked.status} ${JSON.stringify(stocked.body)}`);
      }
    }
  }

  // ---- marketing ----------------------------------------------------------
  console.log('\nBanners');
  for (const banner of BANNERS) {
    await ensure('/banners', 'title', banner.title, { ...banner, isActive: true });
  }

  console.log('\nCoupons');
  for (const coupon of COUPONS) {
    await ensure('/coupons', 'code', coupon.code, coupon);
  }

  // ---- what the storefront will now show ----------------------------------
  console.log('\nWhat the shop has now');
  for (const [label, path] of [
    ['products', '/products?pageSize=1'],
    ['categories', '/categories?pageSize=1'],
    ['brands', '/brands?pageSize=1'],
    ['banners', '/banners?pageSize=1'],
    ['coupons', '/coupons?pageSize=1'],
  ] as const) {
    const result = await call(path);
    const total = result.body?.meta?.total ?? (result.body?.data?.length ?? 0);
    console.log(`  ${label.padEnd(12)} ${total}`);
  }

  console.log(`\n${created} created, ${skipped} already there.`);
  console.log(`\n  storefront   http://${SLUG}.localhost:3003   (or http://localhost:3003)`);
  console.log(`  admin panel  http://${SLUG}.localhost:3002   (or http://localhost:3002)\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
