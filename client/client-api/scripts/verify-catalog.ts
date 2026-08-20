/**
 * Catalogue slice — categories, brands, products — against the live API and a
 * real tenant database.
 *
 *   npx tsx scripts/verify-catalog.ts                       # the dev store
 *   npx tsx scripts/verify-catalog.ts --slug abc-fashion --email … --password …
 *   npx tsx scripts/verify-catalog.ts --keep                # leave the fixtures behind
 *
 * Everything it creates is prefixed `zz-verify-` and removed at the end, so it
 * is safe against a store with real products in it.
 *
 * Like `verify-slice0.ts` this speaks `node:http` rather than `fetch`, because
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

const SLUG = arg('slug') ?? config.devStoreSlug ?? 'abc-fashion';
const EMAIL = arg('email');
const PASSWORD = arg('password');
const KEEP = process.argv.includes('--keep');
const PREFIX = 'zz-verify';

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

async function call(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);

  // No `Origin`. The CSRF check exempts a request that sends none — a browser
  // always does, a script never has to — and sending this store's *platform*
  // origin while the panel is served from a dev hostname would be refused.
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

  for (const raw of result.setCookie) {
    const [pair] = raw.split(';');
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

/** The store's own admin credential, read from the tenant database when not given. */
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
  console.log(`\nCatalogue checks against ${SLUG} on port ${config.api.port}\n`);
  await signIn();

  const created = { categories: [] as string[], brands: [] as string[], products: [] as string[] };

  console.log('1. Brands');
  {
    const create = await call('/brands', { method: 'POST', body: { name: `${PREFIX} Brand` } });
    check('a brand is created', create.status === 201, create.body);
    const brandId = create.body?.data?.id as string;
    created.brands.push(brandId);

    check('its slug is derived from the name', create.body?.data?.slug === `${PREFIX}-brand`, create.body?.data?.slug);

    const twin = await call('/brands', { method: 'POST', body: { name: `${PREFIX} Brand` } });
    check('a second brand of the same name gets a suffixed slug', twin.body?.data?.slug === `${PREFIX}-brand-2`, twin.body?.data?.slug);
    created.brands.push(twin.body?.data?.id);

    const clash = await call('/brands', { method: 'POST', body: { name: 'Anything', slug: `${PREFIX}-brand` } });
    check('an explicitly requested slug that is taken is refused', clash.status === 409, clash.status);
    check('and says which code', clash.body?.code === 'SLUG_TAKEN', clash.body?.code);

    const rename = await call(`/brands/${brandId}`, { method: 'PATCH', body: { name: `${PREFIX} Renamed` } });
    check('renaming does not move the storefront address', rename.body?.data?.slug === `${PREFIX}-brand`, rename.body?.data?.slug);

    const bad = await call('/brands', { method: 'POST', body: { name: '' } });
    check('an empty name is refused per-field', bad.status === 422 && Array.isArray(bad.body?.details?.name), bad.body);
  }

  console.log('\n2. Categories, and the tree');
  {
    const parent = await call('/categories', { method: 'POST', body: { name: `${PREFIX} Parent` } });
    check('a root category is created', parent.status === 201, parent.body);
    const parentId = parent.body?.data?.id as string;
    created.categories.push(parentId);

    const child = await call('/categories', { method: 'POST', body: { name: `${PREFIX} Child`, parentId } });
    check('a child category is created under it', child.status === 201 && child.body?.data?.parentId === parentId);
    const childId = child.body?.data?.id as string;
    created.categories.push(childId);

    const selfParent = await call(`/categories/${parentId}`, { method: 'PATCH', body: { parentId } });
    check('a category cannot be its own parent', selfParent.status === 422, selfParent.status);

    const cycle = await call(`/categories/${parentId}`, { method: 'PATCH', body: { parentId: childId } });
    check('a category cannot move inside its own descendant', cycle.status === 422, cycle.body?.message);

    const ghost = await call('/categories', {
      method: 'POST',
      body: { name: `${PREFIX} Orphan`, parentId: '00000000-0000-0000-0000-000000000000' },
    });
    check('a parent that does not exist is refused', ghost.status === 422, ghost.status);

    const deleteParent = await call(`/categories/${parentId}`, { method: 'DELETE' });
    check('a category with children refuses to be deleted', deleteParent.status === 409, deleteParent.status);
    check('and says which code', deleteParent.body?.code === 'CATEGORY_HAS_CHILDREN', deleteParent.body?.code);
  }

  console.log('\n3. Products, and the variant every product owes');
  {
    const categoryId = created.categories[0];
    const brandId = created.brands[0];

    const create = await call('/products', {
      method: 'POST',
      body: {
        name: `${PREFIX} Product`,
        sku: `${PREFIX}-SKU-1`,
        price: '99.99',
        salePrice: '79.99',
        status: 'active',
        categoryId,
        brandId,
      },
    });
    check('a product is created', create.status === 201, create.body);
    const productId = create.body?.data?.id as string;
    created.products.push(productId);

    check('it is simple, and active', create.body?.data?.type === 'simple' && create.body?.data?.status === 'active');
    check('going active stamps publishedAt', Boolean(create.body?.data?.publishedAt));
    check('it has exactly one variant', create.body?.data?.variants?.length === 1, create.body?.data?.variants?.length);
    check('that variant is the default', create.body?.data?.defaultVariant?.isDefault === true);
    check('the variant carries the SKU and price', create.body?.data?.defaultVariant?.sku === `${PREFIX}-SKU-1`);
    check('price_from is denormalised onto the product', create.body?.data?.priceFrom === '99.99', create.body?.data?.priceFrom);

    const dupSku = await call('/products', {
      method: 'POST',
      body: { name: `${PREFIX} Other`, sku: `${PREFIX}-SKU-1`, price: '10.00' },
    });
    check('a duplicate SKU is refused', dupSku.status === 409 && dupSku.body?.code === 'SKU_TAKEN', dupSku.body?.code);

    const badSale = await call('/products', {
      method: 'POST',
      body: { name: `${PREFIX} Bad`, sku: `${PREFIX}-SKU-2`, price: '10.00', salePrice: '20.00' },
    });
    check('a sale price above the price is refused', badSale.status === 422, badSale.status);
    check('and marks the salePrice field', Array.isArray(badSale.body?.details?.salePrice), badSale.body?.details);

    const badMoney = await call('/products', {
      method: 'POST',
      body: { name: `${PREFIX} Bad2`, sku: `${PREFIX}-SKU-3`, price: '10.999' },
    });
    check('a price with three decimals is refused', badMoney.status === 422, badMoney.status);

    const ghostCategory = await call('/products', {
      method: 'POST',
      body: {
        name: `${PREFIX} Bad3`,
        sku: `${PREFIX}-SKU-4`,
        price: '10.00',
        categoryId: '00000000-0000-0000-0000-000000000000',
      },
    });
    check('a category that does not exist is refused', ghostCategory.status === 422, ghostCategory.status);

    // Only the sale price is sent: the rule still has to see the stored price.
    const partial = await call(`/products/${productId}`, { method: 'PATCH', body: { salePrice: '150.00' } });
    check('a patch is checked against the values it did not send', partial.status === 422, partial.status);

    const priceUp = await call(`/products/${productId}`, { method: 'PATCH', body: { price: '120.00' } });
    check('a price change updates the product and the variant together',
      priceUp.body?.data?.priceFrom === '120.00' && priceUp.body?.data?.defaultVariant?.price === '120.00',
      { product: priceUp.body?.data?.priceFrom, variant: priceUp.body?.data?.defaultVariant?.price });

    const list = await call(`/products?search=${PREFIX}`);
    check('the list finds it by name', list.body?.data?.some((p: { id: string }) => p.id === productId));
    check('the list joins the category and brand names',
      list.body?.data?.[0]?.categoryName != null && list.body?.data?.[0]?.brandName != null,
      list.body?.data?.[0]);
    check(
      'the list carries its cursor meta',
      typeof list.body?.meta?.pageSize === 'number' &&
        typeof list.body?.meta?.hasMore === 'boolean' &&
        list.body?.meta?.nextCursor !== undefined,
      list.body?.meta,
    );
    // The count is on the uncursored read only, which is the one just made.
    check('an uncursored read counts the filtered list', typeof list.body?.meta?.total === 'number', list.body?.meta);

    const byStatus = await call('/products?status=draft');
    check('filtering by a status it is not in excludes it',
      !byStatus.body?.data?.some((p: { id: string }) => p.id === productId));

    const one = await call(`/products/${productId}`);
    check('a single product comes back with its variants', one.body?.data?.variants?.length === 1);

    const missing = await call('/products/00000000-0000-0000-0000-000000000000');
    check('an unknown product is a clean 404', missing.status === 404, missing.status);
  }

  console.log('\n4. Deletion protects order history');
  {
    const productId = created.products[0]!;
    const pool = await openTenantPoolForSlug(SLUG);
    try {
      // Standing in for a real order, which the orders slice does not exist to
      // create yet. `sold_count` is the flag the delete path actually reads.
      await pool.query('update products set sold_count = 3 where id = $1', [productId]);
    } finally {
      await pool.end().catch(() => undefined);
    }

    const sold = await call(`/products/${productId}`, { method: 'DELETE' });
    check('a product that has been ordered is hidden, not deleted', sold.status === 200 && sold.body?.data?.deleted === false, sold.body);
    check('and it is now inactive', sold.body?.data?.product?.status === 'inactive', sold.body?.data?.product?.status);

    const stillThere = await call(`/products/${productId}`);
    check('it is still readable afterwards', stillThere.status === 200);

    const pool2 = await openTenantPoolForSlug(SLUG);
    try {
      await pool2.query('update products set sold_count = 0 where id = $1', [productId]);
    } finally {
      await pool2.end().catch(() => undefined);
    }

    const gone = await call(`/products/${productId}`, { method: 'DELETE' });
    check('one that has never sold is deleted outright', gone.status === 204, gone.status);
    created.products = [];

    const after = await call(`/products/${productId}`);
    check('and is gone', after.status === 404, after.status);
  }

  console.log('\n5. Permissions are enforced by the API');
  {
    const anonymous = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: config.api.port,
          path: '/api/v1/admin/products',
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
    check('the catalogue is unreadable without a session', anonymous === 401, anonymous);
  }

  if (!KEEP) {
    console.log('\nCleaning up…');
    for (const id of created.products) await call(`/products/${id}`, { method: 'DELETE' });
    // Children before parents, or the tree guard refuses.
    for (const id of [...created.categories].reverse()) await call(`/categories/${id}`, { method: 'DELETE' });
    for (const id of created.brands) if (id) await call(`/brands/${id}`, { method: 'DELETE' });
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
await closeRedis().catch(() => undefined);
