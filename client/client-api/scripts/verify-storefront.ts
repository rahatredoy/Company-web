/**
 * The storefront read path — the public surface a customer's browser reads.
 *
 *   npx tsx scripts/verify-storefront.ts
 *   npx tsx scripts/verify-storefront.ts --slug abc-fashion --email … --password …
 *   npx tsx scripts/verify-storefront.ts --other e-comarch   # the isolation check
 *   npx tsx scripts/verify-storefront.ts --keep              # leave the fixtures behind
 *
 * What it is really proving is the claim the whole architecture exists to make:
 * a product added through one store's admin panel appears on **that** store's
 * website and on no other, out of that store's own database.
 *
 * Everything it creates is prefixed `zz-storefront-` and removed at the end, so
 * it is safe to run against a store with real products in it.
 *
 * Like `verify-slice0.ts` and `verify-catalog.ts` this speaks `node:http` rather
 * than `fetch`: `fetch` silently drops a custom `Host`, and the hostname is the
 * entire mechanism by which the API decides which store it is serving.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const ROOT = config.urls.platformRootDomain;
const SLUG = arg('slug') ?? config.devStoreSlug ?? 'abc-fashion';
const OTHER = arg('other') ?? (SLUG === 'abc-fashion' ? (config.devStoreSlug ?? '') : 'abc-fashion');
const EMAIL = arg('email');
const PASSWORD = arg('password');
const KEEP = process.argv.includes('--keep');
const PREFIX = 'zz-storefront';

const STORE_HOST = `${SLUG}.${ROOT}`;
const ADMIN_HOST = `admin.${SLUG}.${ROOT}`;

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

interface Response {
  status: number;
  body: any;
}

const jar = new Map<string, string>();

/**
 * One request, with the store named in the `Host` header and nowhere else.
 *
 * `useJar` is off by default because the storefront surface must work with no
 * session at all — sending the admin's cookie to it would test the wrong thing
 * and hide a route that had accidentally been left guarded.
 */
async function call(
  host: string,
  path: string,
  init: { method?: string; body?: unknown; useJar?: boolean; origin?: string } = {},
): Promise<Response> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);

  const headers: Record<string, string> = {
    accept: 'application/json',
    host,
    ...(payload ? { 'content-type': 'application/json' } : {}),
    ...(init.origin ? { origin: init.origin } : {}),
  };

  if (init.useJar && jar.size > 0) {
    headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const result = await new Promise<{ status: number; setCookie: string[]; text: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: config.api.port, path, method: init.method ?? 'GET', headers },
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

const shop = (path: string, init?: Parameters<typeof call>[2]) =>
  call(STORE_HOST, `/api/v1/storefront${path}`, init);

const admin = (path: string, init?: Parameters<typeof call>[2]) =>
  call(ADMIN_HOST, `/api/v1/admin${path}`, { ...init, useJar: true });

/** The store's own admin credential, read from the tenant database when not given. */
async function signIn(): Promise<void> {
  let email = EMAIL;

  if (!email) {
    const pool = await openTenantPoolForSlug(SLUG);
    try {
      const rows = await pool.query<{ email: string }>('select email from store_admins limit 1');
      email = rows.rows[0]?.email;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  if (!email || !PASSWORD) {
    console.error(
      '\n  Needs the store admin login: --email you@store.com --password "…"\n' +
        `  (the admin on ${SLUG} is ${email ?? 'unknown'})\n`,
    );
    process.exit(1);
  }

  const login = await admin('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (login.status !== 200) {
    console.error(`\n  Could not sign in as ${email}: ${JSON.stringify(login.body)}\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log(`\nStorefront checks against ${STORE_HOST} on port ${config.api.port}\n`);
  await signIn();

  const created = { products: [] as string[], categories: [] as string[] };

  console.log('1. The surface is public, and it is a surface');
  {
    const cfg = await shop('/config');
    check('store config reads with no session at all', cfg.status === 200, cfg.status);
    check('it names this store', cfg.body?.data?.store?.slug === SLUG, cfg.body?.data?.store?.slug);
    check(
      'it carries the locale lists the storefront draws selectors from',
      Array.isArray(cfg.body?.data?.store?.currencies) && cfg.body.data.store.currencies.length >= 1,
      cfg.body?.data?.store?.currencies,
    );
    check(
      'the announcement strip is a list, not a single string',
      Array.isArray(cfg.body?.data?.announcement?.messages),
      cfg.body?.data?.announcement,
    );

    const list = await shop('/products');
    check('the catalogue lists with no session', list.status === 200, list.status);
    check('and carries its facets and paging', Array.isArray(list.body?.data?.filters) && !!list.body?.data?.meta, Object.keys(list.body?.data ?? {}));

    const unknown = await call(`no-such-store.${ROOT}`, '/api/v1/storefront/config');
    check('an unknown hostname is refused', unknown.status === 404, unknown.status);
    check('with STORE_NOT_FOUND', unknown.body?.code === 'STORE_NOT_FOUND', unknown.body?.code);
  }

  console.log('\n2. A new store has a website, not a blank page');
  {
    const home = await shop('/home');
    check('the homepage has sections', Array.isArray(home.body?.data) && home.body.data.length > 0, home.body?.data?.length);

    const faqs = await shop('/faqs');
    check('FAQs are seeded', Array.isArray(faqs.body?.data) && faqs.body.data.length > 0, faqs.body?.data?.length);

    const privacy = await shop('/pages/privacy-policy');
    check('the policy pages exist and are published', privacy.status === 200, privacy.status);

    const cfg = await shop('/config');
    check('the header menu is seeded', (cfg.body?.data?.navigation?.header ?? []).length > 0);
    check('the footer links to the policy pages', (cfg.body?.data?.policyPages ?? []).length > 0);
    check('a payment method is switched on', (cfg.body?.data?.payment?.providers ?? []).length > 0);
  }

  console.log('\n3. Draft stays private, active goes public — the moderation boundary');
  {
    const create = await admin('/products', {
      method: 'POST',
      body: {
        name: `${PREFIX} Widget`,
        status: 'draft',
        sku: `${PREFIX}-sku-1`,
        price: '19.99',
      },
    });
    check('a draft product is created', create.status === 201, create.body);
    const productId = create.body?.data?.id as string;
    const slug = create.body?.data?.slug as string;
    created.products.push(productId);

    /*
     * `sort=newest` rather than the default, so this asks about the moderation
     * boundary and nothing else.
     *
     * The default sort is `relevance` — featured first, sales breaking the tie —
     * over a 24-row page. A store with a real catalogue puts a brand-new product
     * with no sales on page two, so the "it appeared" check failed for want of
     * pagination and the "it is absent" check passed without ever having been
     * able to see it. Newest-first puts this product at position one in both
     * cases, which is the only way either assertion means what it says.
     */
    const hidden = await shop('/products?sort=newest');
    check(
      'a draft is absent from the public listing',
      !(hidden.body?.data?.items ?? []).some((item: any) => item.id === productId),
    );

    const detail404 = await shop(`/products/${slug}`);
    check('and its detail page answers 404', detail404.status === 404, detail404.status);

    const activate = await admin(`/products/${productId}`, { method: 'PATCH', body: { status: 'active' } });
    check('the owner publishes it', activate.status === 200, activate.status);

    /*
     * The point of the whole exercise: no waiting, no second save. The admin
     * write drops this store's storefront cache on the way out (`invalidateStorefrontOnWrite`),
     * so the very next read sees it.
     */
    const listed = await shop('/products?sort=newest');
    check(
      'it appears on the website immediately after publishing',
      (listed.body?.data?.items ?? []).some((item: any) => item.id === productId),
      (listed.body?.data?.items ?? []).map((i: any) => i.slug),
    );

    const detail = await shop(`/products/${slug}`);
    check('its product page renders', detail.status === 200, detail.status);
    check('with the one variant a simple product owns', (detail.body?.data?.variants ?? []).length === 1);
    check('and a price the badge is derived from', detail.body?.data?.price === '19.99', detail.body?.data?.price);
    check(
      'stock is a band, never a count',
      ['in_stock', 'low_stock', 'out_of_stock'].includes(detail.body?.data?.variants?.[0]?.stockLabel),
      detail.body?.data?.variants?.[0]?.stockLabel,
    );
    check(
      'cost price is never exposed',
      !JSON.stringify(detail.body ?? {}).includes('costPrice'),
    );

    const search = await shop(`/search/suggest?q=${PREFIX}`);
    check('it is findable in search-as-you-type', (search.body?.data ?? []).some((s: any) => s.id === productId));

    const deactivate = await admin(`/products/${productId}`, { method: 'PATCH', body: { status: 'inactive' } });
    check('unpublishing works', deactivate.status === 200, deactivate.status);
    // Newest-first for the same reason as above: on the default sort this row
    // would be off the end of page one whether it was published or not.
    const gone = await shop('/products?sort=newest');
    check(
      'and takes it off the website again',
      !(gone.body?.data?.items ?? []).some((item: any) => item.id === productId),
    );
    await admin(`/products/${productId}`, { method: 'PATCH', body: { status: 'active' } });
  }

  console.log('\n4. Inactive taxonomy is invisible too');
  {
    const category = await admin('/categories', {
      method: 'POST',
      body: { name: `${PREFIX} Hidden`, isActive: false },
    });
    check('an inactive category is created', category.status === 201, category.body);
    const categoryId = category.body?.data?.id as string;
    const categorySlug = category.body?.data?.slug as string;
    created.categories.push(categoryId);

    const tree = await shop('/categories');
    const flatten = (nodes: any[]): any[] => nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
    check(
      'it is absent from the public category tree',
      !flatten(tree.body?.data ?? []).some((n: any) => n.id === categoryId),
    );

    const detail = await shop(`/categories/${categorySlug}`);
    check('and its landing page answers 404, not "hidden"', detail.status === 404, detail.status);
  }

  console.log('\n5. The homepage shows the shop, not just how it is filed');
  {
    /*
     * The block behind this read draws each department as a panel of its aisles,
     * every aisle a rail of its own products — so what is asked here is whether
     * those rails can be trusted: nothing over an empty row, nothing named that
     * the shop will not sell, and nothing widened past what was asked for. Every
     * bound is a bound on the work Postgres does, which is why a caller must not
     * be able to talk its way past one.
     */
    const showcase = await shop('/categories/showcase?categories=3&rows=2&perRow=4');
    check(
      'the shop-by-category block answers',
      showcase.status === 200 && Array.isArray(showcase.body?.data),
      showcase.status,
    );

    const groups = (showcase.body?.data ?? []) as any[];
    check('and names at least one department', groups.length > 0, groups.length);
    check('never more departments than asked for', groups.length <= 3, groups.length);
    check(
      'never a heading over an empty row',
      groups.every(
        (group) =>
          (group.rows ?? []).length > 0 &&
          group.rows.every((row: any) => (row.productIds ?? []).length > 0),
      ),
    );
    check(
      'never more rows than asked for',
      groups.every((group) => group.rows.length <= 2),
      groups.map((group) => group.rows.length),
    );
    check(
      'never more products in a row than asked for',
      groups.every((group) => group.rows.every((row: any) => row.productIds.length <= 4)),
    );

    /*
     * The important one. This read is unguarded like the rest of the catalogue,
     * so a draft or deactivated product reaching it would be published by the
     * homepage — and it names ids rather than rows, which is exactly the shape
     * that hides such a leak. Resolving them through the public listing is what
     * proves each one is a product the shop will actually serve.
     */
    const named = [
      ...new Set(groups.flatMap((group) => group.rows.flatMap((row: any) => row.productIds as string[]))),
    ].slice(0, 60);

    if (named.length > 0) {
      const resolved = await shop(`/products?ids=${named.join(',')}`);
      check(
        'every product it names is one the public listing will serve',
        (resolved.body?.data ?? []).length === named.length,
        { named: named.length, resolved: (resolved.body?.data ?? []).length },
      );
    }

    const first = groups[0]?.categoryId as string | undefined;
    if (first) {
      const one = await shop(`/categories/showcase?ids=${first}`);
      const only = (one.body?.data ?? []) as any[];
      check(
        'a block pointed at one department is answered with that one only',
        only.length === 1 && only[0]?.categoryId === first,
        only.map((group) => group.categoryId),
      );
    }

    /*
     * The offset is what lets a homepage carry one of these blocks per
     * department, spread between its other sections. Two blocks at different
     * offsets must therefore answer different departments — were the offset
     * ignored, every panel on the page would be the same one.
     */
    const single = await shop('/categories/showcase?categories=1&rows=1&perRow=2');
    const next = await shop('/categories/showcase?categories=1&rows=1&perRow=2&offset=1');
    const at = (response: Response) => (response.body?.data ?? [])[0]?.categoryId as string | undefined;

    if (at(single)) {
      check('one department per block, and the offset moves it', at(next) !== at(single), {
        first: at(single),
        second: at(next),
      });
    }

    /*
     * A hidden category must answer *nothing*, not everything. Dropping an
     * unknown id and carrying on would turn a block pointed at one department
     * into every department the moment somebody deactivated it.
     */
    const hidden = created.categories[0];
    if (hidden) {
      const nothing = await shop(`/categories/showcase?ids=${hidden}`);
      check(
        'an inactive category answers nothing rather than the whole shop',
        (nothing.body?.data ?? []).length === 0,
        nothing.body?.data?.length,
      );
    }
  }

  console.log('\n6. The filter panel offers only what narrows, and narrows by what it offers');
  {
    /*
     * Every claim here is checked the same way: take the count the panel printed
     * beside an option, ask the listing for that option, and require the total to
     * be the number the shopper was shown. A facet that counts one thing and
     * filters another is the failure this section exists to catch, and it is
     * invisible from the outside — both halves answer 200.
     */
    const list = await shop('/products');
    const total = Number(list.body?.data?.meta?.total ?? 0);
    const groups: any[] = list.body?.data?.filters ?? [];
    const byKey = new Map<string, any>(groups.map((group) => [group.key, group]));

    check(
      'every group is a shape the storefront knows how to draw',
      groups.length > 0 &&
        groups.every(
          (group) =>
            (group.type === 'checkbox' || group.type === 'price') &&
            Array.isArray(group.options) &&
            group.options.length > 0,
        ),
      groups.map((group) => `${group.key}:${group.type}:${group.options?.length}`),
    );

    check(
      'no option is a dead end — every one would return something',
      groups.every((group) => group.options.every((option: any) => Number(option.count) > 0)),
      groups.flatMap((group) =>
        group.options.filter((option: any) => !(Number(option.count) > 0)).map((option: any) => `${group.key}=${option.value}`),
      ),
    );

    // Colour picks a variant, which is the product page's job; a swatch list in
    // the sidebar answered a question nobody asks before choosing the product.
    check(
      'the sidebar offers no colour list',
      !groups.some((group) => group.key === 'colour' || group.key === 'color'),
      groups.map((group) => group.key),
    );
    check('nor a star ladder — "Top Rated" is an offer now', !byKey.has('rating'), [...byKey.keys()]);

    const category = byKey.get('sub');
    check('it opens with the departments', category?.label === 'Category', category?.label);

    if (category?.options?.length) {
      const [first, second] = category.options;
      const one = await shop(`/products?sub=${encodeURIComponent(first.value)}`);
      check(
        'a department returns exactly what it counted',
        Number(one.body?.data?.meta?.total) === Number(first.count),
        { department: first.value, counted: first.count, returned: one.body?.data?.meta?.total },
      );

      if (second) {
        const both = await shop(
          `/products?sub=${encodeURIComponent(first.value)}&sub=${encodeURIComponent(second.value)}`,
        );
        // Top-level departments are disjoint subtrees, so the union is the sum.
        // Intersecting them — the bug a merged category filter would have — would
        // answer zero here.
        check(
          'two departments are a union, not an intersection',
          Number(both.body?.data?.meta?.total) === Number(first.count) + Number(second.count),
          { expected: first.count + second.count, returned: both.body?.data?.meta?.total },
        );

        const facetsWhileTicked: any[] = one.body?.data?.filters ?? [];
        const stillThere = facetsWhileTicked.find((group) => group.key === 'sub');
        check(
          'and ticking one leaves the others on the panel to untick it with',
          (stillThere?.options ?? []).length === category.options.length,
          { before: category.options.length, after: stillThere?.options?.length },
        );
      }
    }

    const offers = byKey.get('offer');
    check('the offers group is there', offers?.label === 'Offers', offers?.label);

    for (const option of offers?.options ?? []) {
      const narrowed = await shop(`/products?offer=${encodeURIComponent(option.value)}`);
      check(
        `"${option.label}" returns exactly what it counted`,
        Number(narrowed.body?.data?.meta?.total) === Number(option.count),
        { counted: option.count, returned: narrowed.body?.data?.meta?.total },
      );
    }

    if ((offers?.options ?? []).length > 1) {
      const [first, second] = offers.options;
      const either = await shop(
        `/products?offer=${encodeURIComponent(first.value)}&offer=${encodeURIComponent(second.value)}`,
      );
      const union = Number(either.body?.data?.meta?.total);
      check(
        'two offers are "either", so the result is at least the larger of them',
        union >= Math.max(Number(first.count), Number(second.count)) &&
          union <= Math.min(total, Number(first.count) + Number(second.count)),
        { first: first.count, second: second.count, union },
      );
    }

    const price = byKey.get('price');
    check(
      'price is a ladder of bands, each carrying its own bounds',
      price?.type === 'price' &&
        price.options.length > 1 &&
        price.options.every((option: any) => typeof option.min === 'number'),
      price?.options,
    );

    for (const option of price?.options ?? []) {
      const narrowed = await shop(`/products?price=${encodeURIComponent(option.value)}`);
      check(
        `the ${option.label} band returns exactly what it counted`,
        Number(narrowed.body?.data?.meta?.total) === Number(option.count),
        { counted: option.count, returned: narrowed.body?.data?.meta?.total },
      );
    }

    // Half-open bounds: a product priced at a boundary belongs to one band only,
    // so the bands can never add up to more than the shop holds.
    check(
      'the bands do not overlap',
      (price?.options ?? []).reduce((sum: number, option: any) => sum + Number(option.count), 0) <= total,
      { bands: (price?.options ?? []).map((option: any) => option.count), total },
    );

    // Both lists are whitelists, so a hand-edited URL asks for nothing rather
    // than for something the panel could not have offered.
    const invented = await shop('/products?price=137-999');
    check(
      'an invented price band is ignored rather than honoured',
      Number(invented.body?.data?.meta?.total) === total,
      invented.body?.data?.meta?.total,
    );

    const nonsense = await shop('/products?offer=free_unicorn');
    check(
      'and so is an invented offer',
      Number(nonsense.body?.data?.meta?.total) === total,
      nonsense.body?.data?.meta?.total,
    );

    // Twenty is what the storefront asks for a batch of; the endpoint still
    // pages, because a scrolled listing is built out of pages.
    const batch = await shop('/products?pageSize=20&page=2');
    check(
      'the listing still pages, which is what the scroll is made of',
      batch.status === 200 && (batch.body?.data?.items ?? []).length <= 20,
      { status: batch.status, items: batch.body?.data?.items?.length },
    );
  }

  console.log('\n7. The two surfaces stay apart');
  {
    const adminFromShopHost = await call(STORE_HOST, '/api/v1/admin/products', {
      origin: `http://${STORE_HOST}`,
    });
    check(
      'a storefront origin cannot reach the admin API',
      adminFromShopHost.status === 401 || adminFromShopHost.status === 403,
      adminFromShopHost.status,
    );

    const forged = await shop('/products?slug=someone-else');
    check('a slug in the query string is ignored', forged.status === 200, forged.status);
  }

  console.log('\n8. Isolation — the claim the architecture exists to make');
  if (!OTHER || OTHER === SLUG) {
    console.log('  SKIP  no second store given; pass --other <slug> to check cross-tenant isolation');
  } else {
    const otherHost = `${OTHER}.${ROOT}`;
    const theirs = await call(otherHost, '/api/v1/storefront/products');

    if (theirs.status !== 200) {
      console.log(`  SKIP  ${OTHER} did not resolve (${theirs.status}); cannot compare`);
    } else {
      const mine = new Set(created.products);
      check(
        `products created on ${SLUG} are absent from ${OTHER}'s website`,
        !(theirs.body?.data?.items ?? []).some((item: any) => mine.has(item.id)),
      );

      const theirConfig = await call(otherHost, '/api/v1/storefront/config');
      check(
        'and the two stores report different identities',
        theirConfig.body?.data?.store?.slug === OTHER,
        theirConfig.body?.data?.store?.slug,
      );
    }
  }

  if (!KEEP) {
    console.log('\nCleaning up…');
    for (const id of created.products) await admin(`/products/${id}`, { method: 'DELETE' });
    for (const id of created.categories) await admin(`/categories/${id}`, { method: 'DELETE' });
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
await closeRedis().catch(() => undefined);
