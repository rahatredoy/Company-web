/**
 * The product screen — creating a product the way the panel now creates one, and
 * reading back the figures it shows — against the live API and a real tenant
 * database.
 *
 *   npx tsx scripts/verify-product-insights.ts --email … --password …
 *   npx tsx scripts/verify-product-insights.ts --keep     # leave the fixtures behind
 *
 * Everything it creates is prefixed `zz-insights-` and removed at the end, so it
 * is safe against a store with real products in it.
 *
 * Like `verify-catalog.ts` this speaks `node:http` rather than `fetch`, because
 * `fetch` silently drops a custom `Host` and the hostname is how the API decides
 * which store it is serving.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug ?? 'e-comarch';
const EMAIL = arg('email');
const PASSWORD = arg('password');
const KEEP = process.argv.includes('--keep');
const PREFIX = 'zz-insights';

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

const jar = new Map<string, string>();

async function raw(
  path: string,
  init: { method?: string; body?: unknown; prefix?: string; host?: string } = {},
): Promise<{ status: number; body: any }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);

  // No `Origin`. The CSRF check exempts a request that sends none — a browser
  // always does, a script never has to.
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
          path: `${init.prefix ?? '/api/v1/admin'}${path}`,
          method: init.method ?? 'GET',
          headers: {
            ...headers,
            host: init.host ?? `admin.${SLUG}.${config.urls.platformRootDomain}`,
          },
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

  for (const line of result.setCookie) {
    const [pair] = line.split(';');
    const [name, ...rest] = (pair ?? '').split('=');
    if (name) jar.set(name.trim(), rest.join('='));
  }

  let body: unknown = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    body = result.text;
  }

  return { status: result.status, body };
}

const call = (path: string, init?: Parameters<typeof raw>[1]) => raw(path, init);

/** The storefront half, which has no session and its own hostname rules. */
const shop = (path: string) =>
  raw(path, { prefix: '/api/v1/storefront', host: `${SLUG}.${config.urls.platformRootDomain}` });

async function signIn(): Promise<void> {
  let email = EMAIL;
  const password = PASSWORD;

  if (!email) {
    const pool = await openTenantPoolForSlug(SLUG);
    try {
      const rows = await pool.query<{ email: string }>('select email from store_admins limit 1');
      email = rows.rows[0]?.email;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  if (!email || !password) {
    console.error(
      '\n  Needs the store admin login: --email you@store.com --password "…"\n' +
        `  (the admin on ${SLUG} is ${email ?? 'unknown'})\n`,
    );
    process.exit(1);
  }

  const login = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (login.status !== 200) {
    console.error(`\n  Could not sign in as ${email}: ${JSON.stringify(login.body)}\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log(`\nProduct screen checks against ${SLUG} on port ${config.api.port}\n`);
  await signIn();

  const created = { products: [] as string[], categories: [] as string[] };

  // A parent and a child, so the screen's category/subcategory split has a real
  // two-deep branch to resolve rather than a flat one that would pass either way.
  const parent = await call('/categories', { method: 'POST', body: { name: `${PREFIX} Parent` } });
  const parentId = parent.body?.data?.id as string;
  created.categories.push(parentId);
  const child = await call('/categories', { method: 'POST', body: { name: `${PREFIX} Child`, parentId } });
  const childId = child.body?.data?.id as string;
  created.categories.push(childId);

  console.log('1. Adding a product the way the panel adds one');
  let simpleId = '';
  {
    const create = await call('/products', {
      method: 'POST',
      body: {
        name: `${PREFIX} Simple`,
        status: 'active',
        categoryId: childId,
        sku: `${PREFIX}-SKU-1`,
        barcode: '5901234123457',
        price: '120.00',
        salePrice: '99.00',
        costPrice: '60.00',
        imageUrl: 'https://example.com/main.jpg',
        videoUrl: 'https://example.com/clip.mp4',
        galleryImages: ['https://example.com/g1.jpg', 'https://example.com/g2.jpg'],
        stockQuantity: 40,
        lowStockThreshold: 8,
        trackInventory: true,
      },
    });

    check('a product is created with its opening stock', create.status === 201, create.body);
    simpleId = create.body?.data?.id as string;
    created.products.push(simpleId);

    check('the video link is stored', create.body?.data?.videoUrl === 'https://example.com/clip.mp4', create.body?.data?.videoUrl);
    check('stock tracking is on', create.body?.data?.trackInventory === true, create.body?.data?.trackInventory);

    const read = await call(`/products/${simpleId}`);
    check('the gallery was written as its own list', read.body?.data?.media?.length === 2, read.body?.data?.media?.length);
    check(
      'the main image is not one of the gallery rows',
      !(read.body?.data?.media ?? []).some((row: any) => row.url === 'https://example.com/main.jpg'),
      read.body?.data?.media,
    );

    // Searched rather than listed: the inventory list is a scroll, and a store
    // with twenty other variants would answer the first batch and not this row.
    const inventory = await call(`/inventory?search=${PREFIX}-SKU-1`);
    const level = (inventory.body?.data ?? []).find((row: any) => row.sku === `${PREFIX}-SKU-1`);
    check('an inventory level was opened for it', Boolean(level), inventory.body?.data?.length);
    check('holding the opening quantity', level?.available === 40, level?.available);
    check('and the low-stock line it was given', level?.lowStockThreshold === 8, level?.lowStockThreshold);
  }

  console.log('\n2. The figures the product screen reads');
  {
    const insights = await call(`/products/${simpleId}/insights?days=30`);
    check('the screen endpoint answers', insights.status === 200, insights.body);

    const data = insights.body?.data;
    check('total stock received is the opening balance', data?.stock?.received === 40, data?.stock?.received);
    check('available matches the level', data?.stock?.available === 40, data?.stock?.available);
    check('nothing has sold yet', data?.stock?.sold === 0, data?.stock?.sold);
    check('it is neither low nor out', data?.stock?.isLow === false && data?.stock?.isOut === false, data?.stock);
    check('it is not reported as untracked', data?.stock?.isUntracked === false, data?.stock?.isUntracked);

    check('the SKU is carried', data?.product?.sku === `${PREFIX}-SKU-1`, data?.product?.sku);
    check('the barcode is carried', data?.product?.barcode === '5901234123457', data?.product?.barcode);
    check('the parent reads as the category', data?.product?.category?.id === parentId, data?.product?.category);
    check('and the child as the subcategory', data?.product?.subcategory?.id === childId, data?.product?.subcategory);

    check('one variant is listed', data?.variants?.length === 1, data?.variants?.length);
    check('with its own available count', data?.variants?.[0]?.available === 40, data?.variants?.[0]);

    const opening = (data?.movements ?? []).find((row: any) => row.type === 'initial');
    check('the opening balance is in the ledger', Boolean(opening), data?.movements);
    check('as a positive movement of the right size', opening?.quantity === 40, opening?.quantity);
    check('naming who set it', typeof opening?.adminLabel === 'string', opening?.adminLabel);

    check('the sales series is gap-free over the window', data?.sales?.series?.length === 30, data?.sales?.series?.length);
    check(
      'and every bucket carries a figure rather than a hole',
      (data?.sales?.series ?? []).every((row: any) => typeof row.units === 'number' && typeof row.revenue === 'string'),
      data?.sales?.series?.[0],
    );

    check('money is zero before anything sells', data?.money?.revenue === '0.00', data?.money?.revenue);
    check('average selling price is null rather than zero', data?.money?.averageSellingPrice === null, data?.money);
    check('return rate is null rather than zero', data?.returns?.rate === null, data?.returns);
  }

  console.log('\n3. A product that comes in options');
  let variableId = '';
  {
    const attributes = await call('/attributes');
    const option = (attributes.body?.data ?? []).find(
      (row: any) => row.isVariantAttribute && row.values?.length >= 2,
    );
    const values: string[] = (option?.values ?? []).slice(0, 2).map((row: any) => row.id);

    const create = await call('/products', {
      method: 'POST',
      body: {
        name: `${PREFIX} Variable`,
        status: 'active',
        costPrice: '30.00',
        variants: [
          {
            sku: `${PREFIX}-VAR-A`,
            title: 'Small',
            price: '80.00',
            stockQuantity: 5,
            attributeValueIds: values[0] ? [values[0]] : [],
          },
          {
            sku: `${PREFIX}-VAR-B`,
            title: 'Large',
            price: '60.00',
            salePrice: '50.00',
            stockQuantity: 12,
            attributeValueIds: values[1] ? [values[1]] : [],
          },
        ],
        lowStockThreshold: 3,
      },
    });

    check('a product is created straight from a variant list', create.status === 201, create.body);
    variableId = create.body?.data?.id as string;
    created.products.push(variableId);

    check('it is typed variable', create.body?.data?.type === 'variable', create.body?.data?.type);
    check('two variants were written', create.body?.data?.variants?.length === 2, create.body?.data?.variants?.length);
    check(
      'price_from is the cheapest sellable variant, not the first',
      create.body?.data?.priceFrom === '60.00' && create.body?.data?.salePriceFrom === '50.00',
      { from: create.body?.data?.priceFrom, sale: create.body?.data?.salePriceFrom },
    );

    const insights = await call(`/products/${variableId}/insights`);
    check('both variants carry their own stock', insights.body?.data?.stock?.available === 17, insights.body?.data?.stock);
    check(
      'the cost price is copied onto every variant so profit has a basis',
      (insights.body?.data?.variants ?? []).every((row: any) => row.costPrice === '30.00'),
      insights.body?.data?.variants?.map((row: any) => row.costPrice),
    );

    const clash = await call('/products', {
      method: 'POST',
      body: {
        name: `${PREFIX} Clash`,
        variants: [
          { sku: `${PREFIX}-DUP`, price: '10.00' },
          { sku: `${PREFIX}-DUP`, price: '12.00' },
        ],
      },
    });
    check('two variants sharing a SKU are refused', clash.status === 422, clash.status);

    const missing = await call('/products', { method: 'POST', body: { name: `${PREFIX} Bare` } });
    check('a product with neither a SKU nor a variant list is refused', missing.status === 422, missing.status);
    check(
      'and says which fields are missing',
      Array.isArray(missing.body?.details?.sku) && Array.isArray(missing.body?.details?.price),
      missing.body?.details,
    );
  }

  console.log('\n4. Stock tracking is a real switch, not a label');
  {
    // Emptied first: with tracking on this is out of stock, so the storefront's
    // answer is only interesting once the switch is flipped.
    const insights = await call(`/products/${simpleId}/insights`);
    const variantId = insights.body?.data?.variants?.[0]?.id as string;
    const inventory = await call(`/inventory?search=${PREFIX}-SKU-1`);
    const level = (inventory.body?.data ?? []).find((row: any) => row.variantId === variantId);

    const emptied = await call('/inventory/adjust', {
      method: 'POST',
      body: { variantId, warehouseId: level?.warehouseId, bucket: 'available', delta: -40, reason: 'verify' },
    });
    check('the shelf can be emptied through the ledger', emptied.status === 200, emptied.body);

    const empty = await call(`/products/${simpleId}/insights`);
    check('emptying the shelf reads as out of stock', empty.body?.data?.stock?.isOut === true, empty.body?.data?.stock);

    const slug = empty.body?.data?.product?.slug as string;
    const sold = await shop(`/products/${slug}`);
    check('and the shop says so', sold.body?.data?.inStock === false, sold.body?.data?.inStock);

    const off = await call(`/products/${simpleId}`, { method: 'PATCH', body: { trackInventory: false } });
    check('tracking can be switched off', off.body?.data?.trackInventory === false, off.body?.data?.trackInventory);

    const untracked = await call(`/products/${simpleId}/insights`);
    check(
      'an untracked product is never out of stock',
      untracked.body?.data?.stock?.isOut === false && untracked.body?.data?.stock?.isUntracked === true,
      untracked.body?.data?.stock,
    );
    check(
      'but the count is still kept and still readable',
      untracked.body?.data?.stock?.received === 40 && untracked.body?.data?.stock?.available === 0,
      untracked.body?.data?.stock,
    );

    const shopAgain = await shop(`/products/${slug}`);
    check('and the shop sells it again', shopAgain.body?.data?.inStock === true, shopAgain.body?.data?.inStock);

    await call(`/products/${simpleId}`, { method: 'PATCH', body: { trackInventory: true } });
  }

  console.log('\n5. Editing one variant does not re-price the others');
  {
    const before = await call(`/products/${variableId}`);
    const patched = await call(`/products/${variableId}`, { method: 'PATCH', body: { price: '200.00' } });

    check('the default variant takes the new price', patched.body?.data?.defaultVariant?.price === '200.00', patched.body?.data?.defaultVariant?.price);
    check(
      'but price_from still follows the cheapest variant',
      patched.body?.data?.priceFrom === '60.00',
      { was: before.body?.data?.priceFrom, now: patched.body?.data?.priceFrom },
    );

    const archived = await call(`/products/${variableId}`, { method: 'PATCH', body: { status: 'inactive' } });
    check('archiving is a status change, not a delete', archived.body?.data?.status === 'inactive', archived.body?.data?.status);

    const restored = await call(`/products/${variableId}`, { method: 'PATCH', body: { status: 'draft' } });
    check('and it comes back as a draft', restored.body?.data?.status === 'draft', restored.body?.data?.status);
  }

  console.log('\n6. The screen refuses what it should');
  {
    const unknown = await call('/products/00000000-0000-4000-8000-000000000000/insights');
    check('an unknown product is a clean 404', unknown.status === 404, unknown.status);

    const anonymous = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: config.api.port,
          path: `/api/v1/admin/products/${simpleId}/insights`,
          method: 'GET',
          headers: { host: `admin.${SLUG}.${config.urls.platformRootDomain}`, accept: 'application/json' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    check('the figures are unreadable without a session', anonymous === 401, anonymous);
  }

  if (!KEEP) {
    console.log('\nCleaning up…');
    for (const id of created.products) if (id) await call(`/products/${id}`, { method: 'DELETE' });
    // Children before parents, or the tree guard refuses.
    for (const id of [...created.categories].reverse()) {
      if (id) await call(`/categories/${id}`, { method: 'DELETE' });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
await closeRedis().catch(() => undefined);
