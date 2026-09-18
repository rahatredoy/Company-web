/**
 * The fields the panel's edit forms write.
 *
 * An edit form is only as good as the round trip: a control the API silently
 * drops looks identical to one that saved. This sets each field the forms offer,
 * reads the record back, and asserts the value actually landed — which is how
 * `PUT /attributes/:id` was caught accepting a `slug` and never writing it.
 *
 * It **creates and deletes its own fixtures** (a category, a product, an
 * attribute), so run it against a throwaway store rather than `e-comarch`.
 * The customer checks need an existing shopper and skip themselves without one.
 * Two records it does not create — a customer's marketing consent and the
 * store's design row — are read, changed, and put back as they were.
 *
 * Usage:
 *   npx tsx scripts/verify-edit-fields.ts --slug throwaway --email a@b.c --password '…'
 */

const args = process.argv.slice(2);

function arg(name: string, fallback?: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:4100')!;
const SLUG = arg('slug', process.env.DEV_STORE_SLUG ?? 'e-comarch')!;
const EMAIL = arg('email', 'redoyahmed198@gmail.com')!;
const PASSWORD = arg('password');
const KEEP = args.includes('--keep');

if (!PASSWORD) {
  console.error("Pass the store admin password: --password '…'");
  process.exit(1);
}

let passed = 0;
let failed = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(label: string, why: string): void {
  skipped += 1;
  console.log(`  skip ${label} — ${why}`);
}

let cookie = '';

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-Store-Slug': SLUG,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  const envelope = payload as { data?: T } | null;
  return { status: response.status, body: (envelope && 'data' in envelope ? envelope.data : payload) as T };
}

async function signIn(): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/admin/auth/login`, {
    method: 'POST',
    // Originless on purpose — see `plugins/security.ts`; a script has no admin
    // surface hostname it could honestly claim.
    headers: { 'Content-Type': 'application/json', 'X-Store-Slug': SLUG },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!response.ok) throw new Error(`Sign-in failed (${response.status}): ${await response.text()}`);

  cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Sign-in returned no session cookie.');
}

const stamp = process.pid.toString(36);
const bin: { path: string }[] = [];

async function main(): Promise<void> {
  console.log(`\nEdit fields · ${SLUG} · ${BASE}\n`);
  await signIn();
  console.log(`Signed in as ${EMAIL}\n`);

  // ------------------------------------------------------------- product ----
  console.log('The product editor’s Details tab');
  const created = await call<{ id: string; slug: string }>('/api/v1/admin/products', {
    method: 'POST',
    body: {
      name: `zz edit fields ${stamp}`,
      sku: `ZZ-EDIT-${stamp.toUpperCase()}`,
      price: '19.99',
      status: 'draft',
    },
  });

  if (created.status !== 201 && created.status !== 200) {
    check('a fixture product could be created', false, `got ${created.status}`);
  } else {
    bin.push({ path: `/api/v1/admin/products/${created.body.id}` });

    // Exactly what the Details tab now sends.
    const patch = await call(`/api/v1/admin/products/${created.body.id}`, {
      method: 'PATCH',
      body: {
        name: `zz edit fields ${stamp}`,
        slug: `zz-edit-fields-${stamp}-moved`,
        minOrderQuantity: 3,
        maxOrderQuantity: 12,
        seoTitle: 'A title for search engines',
        seoDescription: 'A description for search engines.',
      },
    });
    check('accepts the fields the form sends', patch.status === 200, `got ${patch.status}`);

    const after = await call<Record<string, unknown>>(`/api/v1/admin/products/${created.body.id}`);
    check('the storefront address moved', after.body.slug === `zz-edit-fields-${stamp}-moved`, String(after.body.slug));
    check('minimum per order saved', after.body.minOrderQuantity === 3, String(after.body.minOrderQuantity));
    check('maximum per order saved', after.body.maxOrderQuantity === 12, String(after.body.maxOrderQuantity));
    check('SEO title saved', after.body.seoTitle === 'A title for search engines', String(after.body.seoTitle));
    check(
      'SEO description saved',
      after.body.seoDescription === 'A description for search engines.',
      String(after.body.seoDescription),
    );

    // Null is "no limit", which is a different answer from zero.
    const cleared = await call(`/api/v1/admin/products/${created.body.id}`, {
      method: 'PATCH',
      body: { maxOrderQuantity: null, seoTitle: null },
    });
    const afterClear = await call<Record<string, unknown>>(`/api/v1/admin/products/${created.body.id}`);
    check('an emptied maximum clears to no limit', cleared.status === 200 && afterClear.body.maxOrderQuantity === null);
    check('an emptied SEO title clears', afterClear.body.seoTitle === null);

    // Re-sending the unchanged slug must not collide with the row itself.
    const resave = await call(`/api/v1/admin/products/${created.body.id}`, {
      method: 'PATCH',
      body: { slug: `zz-edit-fields-${stamp}-moved`, name: 'zz renamed once more' },
    });
    check('re-sending the same slug is not a clash', resave.status === 200, `got ${resave.status}`);
  }

  // ----------------------------------------------------------- sale price ----
  //
  // A sale price has no dates: it applies from the moment it is saved until it
  // is cleared, so these assert the *shopper's* price, not just the column.
  console.log('
The sale price');
  const onSale = await call<{ id: string; slug: string }>('/api/v1/admin/products', {
    method: 'POST',
    body: {
      name: `zz sale price ${stamp}`,
      sku: `ZZ-SALE-${stamp.toUpperCase()}`,
      price: '100.00',
      salePrice: '60.00',
      status: 'active',
      stockQuantity: 5,
    },
  });

  if (onSale.status !== 201 && onSale.status !== 200) {
    check('a fixture product could be created', false, `got ${onSale.status}`);
  } else {
    bin.push({ path: `/api/v1/admin/products/${onSale.body.id}` });

    const shopper = async () => {
      const response = await fetch(`${BASE}/api/v1/storefront/products/${onSale.body.slug}`, {
        headers: { 'X-Store-Slug': SLUG, Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
      return payload?.data ?? null;
    };

    const live = await shopper();
    check('a saved sale price is charged', live?.salePrice === '60.00', String(live?.salePrice));

    // A patch that says nothing about the sale price must leave it alone.
    await call(`/api/v1/admin/products/${onSale.body.id}`, {
      method: 'PATCH',
      body: { name: `zz sale price ${stamp} renamed` },
    });
    const untouched = await call<Record<string, unknown>>(`/api/v1/admin/products/${onSale.body.id}`);
    const defaultVariant = untouched.body.defaultVariant as Record<string, unknown> | null;
    check('a patch that omits the sale price keeps it', defaultVariant?.salePrice === '60.00', String(defaultVariant?.salePrice));
    check(
      'the record carries no sale dates',
      !!defaultVariant && !('saleStartsAt' in defaultVariant) && !('saleEndsAt' in defaultVariant),
    );
  }

  // ------------------------------------------------------------ category ----
  console.log('\nThe category panel’s image');
  const category = await call<{ id: string }>('/api/v1/admin/categories', {
    method: 'POST',
    body: { name: `zz edit cat ${stamp}` },
  });

  if (category.status !== 201 && category.status !== 200) {
    check('a fixture category could be created', false, `got ${category.status}`);
  } else {
    bin.push({ path: `/api/v1/admin/categories/${category.body.id}` });
    const image = 'https://example.com/category.jpg';

    // PATCH, not PUT — the category route is the one partial writer in the
    // catalogue, which is what lets the tree reorder touch `sortOrder` alone.
    const saved = await call(`/api/v1/admin/categories/${category.body.id}`, {
      method: 'PATCH',
      body: { imageUrl: image },
    });
    check('accepts a category image', saved.status === 200, `got ${saved.status}`);

    // The description, menu icon and page banner were dropped (migration 0013);
    // a record still carrying one means a select somewhere was not updated.
    const after = await call<Record<string, unknown>>(`/api/v1/admin/categories/${category.body.id}`);
    const retired = ['description', 'iconUrl', 'bannerUrl'].filter((key) => key in after.body);
    check(
      'the image saved, and no retired column came back',
      after.body.imageUrl === image && retired.length === 0,
      retired.length ? `still returns ${retired.join(', ')}` : String(after.body.imageUrl),
    );
  }

  // -------------------------------------------------------------- banner ----
  /*
   * A banner's destination, which is a picker over the catalogue rather than a
   * typed address — so the round trip has to cover the category *and* what the
   * storefront turns it into. `banners.category_id` sat declared and unread for
   * long enough that the panel had no control for it at all; the checks below
   * are what stop it going quiet again.
   */
  console.log('\nThe banner panel’s destination');

  if (!category.body?.id) {
    skip('banner destination', 'the fixture category could not be created');
  } else {
    const child = await call<{ id: string; slug: string }>('/api/v1/admin/categories', {
      method: 'POST',
      body: { name: `zz edit sub ${stamp}`, parentId: category.body.id },
    });

    if (child.status !== 201 && child.status !== 200) {
      check('a fixture subcategory could be created', false, `got ${child.status}`);
    } else {
      // Ahead of the parent in the bin, which is reversed on cleanup — a
      // category with children is refused outright (`CATEGORY_HAS_CHILDREN`).
      bin.push({ path: `/api/v1/admin/categories/${child.body.id}` });

      const artwork = 'https://example.com/promo.jpg';
      const banner = await call<{ id: string }>('/api/v1/admin/banners', {
        method: 'POST',
        body: {
          title: `zz Edit Banner ${stamp}`,
          imageUrl: artwork,
          position: 'home_promo',
          categoryId: child.body.id,
          isActive: true,
        },
      });

      check('accepts a subcategory as the destination', banner.status === 201, `got ${banner.status}`);

      if (banner.status === 201) {
        bin.push({ path: `/api/v1/admin/banners/${banner.body.id}` });

        const after = await call<Record<string, unknown>>(`/api/v1/admin/banners/${banner.body.id}`);
        check('the destination saved', after.body.categoryId === child.body.id, String(after.body.categoryId));
        check(
          'and is reported with the slug the shop needs',
          after.body.categorySlug === child.body.slug,
          String(after.body.categorySlug),
        );

        /*
         * The point of the whole field: the storefront never sees the uuid. A
         * homepage block naming the placement is what pulls the banner through,
         * so this asserts the pair rather than the column — through the store's
         * own `home_promo` block, since the panel has no homepage editor to add
         * a fixture one. Every store is seeded with two.
         */
        const home = await call<{ id: string; type: string; config: Record<string, unknown> }[]>(
          '/api/v1/storefront/home',
        );
        const rendered = Array.isArray(home.body)
          ? home.body.find((entry) => entry.config?.bannerPosition === 'home_promo')
          : undefined;

        if (!rendered) {
          skip('the storefront is given the banner', 'this homepage has no block naming home_promo');
        } else {
          const list = (rendered.config.banners ?? []) as Record<string, unknown>[];
          const mine = list.find((entry) => entry.id === banner.body.id);

          check('the storefront is given the banner', Boolean(mine), `${list.length} banner(s) in the block`);
          check(
            'and a category link rather than a uuid',
            mine?.linkUrl === `/category/${child.body.slug}`,
            String(mine?.linkUrl),
          );
        }

        // Switching to a typed address must *clear* the category, not sit
        // behind it: the category outranks `linkUrl`, so a stale one left in
        // place would keep winning and the new address would never be used.
        const moved = await call(`/api/v1/admin/banners/${banner.body.id}`, {
          method: 'PUT',
          body: {
            title: `zz Edit Banner ${stamp}`,
            imageUrl: artwork,
            position: 'home_promo',
            linkUrl: '/sale',
            isActive: true,
          },
        });
        check('accepts a typed address instead', moved.status === 200, `got ${moved.status}`);

        const swapped = await call<Record<string, unknown>>(`/api/v1/admin/banners/${banner.body.id}`);
        check('the category was cleared', swapped.body.categoryId === null, String(swapped.body.categoryId));
        check('and the address took its place', swapped.body.linkUrl === '/sale', String(swapped.body.linkUrl));

        const bogus = await call(`/api/v1/admin/banners/${banner.body.id}`, {
          method: 'PUT',
          body: {
            title: `zz Edit Banner ${stamp}`,
            imageUrl: artwork,
            position: 'home_promo',
            categoryId: '00000000-0000-4000-8000-000000000000',
            isActive: true,
          },
        });
        check('a category that does not exist is refused', bogus.status === 422, `got ${bogus.status}`);
      }
    }
  }

  // ----------------------------------------------------------- attribute ----
  console.log('\nThe attribute panel’s filter key');
  const attribute = await call<{ id: string; slug: string }>('/api/v1/admin/attributes', {
    method: 'POST',
    body: { name: `zz Edit Attr ${stamp}`, values: [{ value: 'One' }] },
  });

  if (attribute.status !== 201 && attribute.status !== 200) {
    check('a fixture attribute could be created', false, `got ${attribute.status}`);
  } else {
    bin.push({ path: `/api/v1/admin/attributes/${attribute.body.id}` });

    const moved = `zz-attr-${stamp}-moved`;
    const saved = await call(`/api/v1/admin/attributes/${attribute.body.id}`, {
      method: 'PUT',
      body: { name: `zz Edit Attr ${stamp}`, slug: moved, values: [] },
    });
    check('accepts a filter key', saved.status === 200, `got ${saved.status}`);

    const list = await call<{ id: string; slug: string; name: string }[]>('/api/v1/admin/attributes');
    const found = Array.isArray(list.body) ? list.body.find((row) => row.id === attribute.body.id) : undefined;

    // The regression this exists for: the update used to omit the column, so the
    // request answered 200 and the slug never moved.
    check('the filter key actually moved', found?.slug === moved, `slug is ${found?.slug}`);

    const renamed = await call(`/api/v1/admin/attributes/${attribute.body.id}`, {
      method: 'PUT',
      body: { name: `zz Renamed ${stamp}`, values: [] },
    });
    const afterRename = await call<{ id: string; slug: string }[]>('/api/v1/admin/attributes');
    const still = Array.isArray(afterRename.body)
      ? afterRename.body.find((row) => row.id === attribute.body.id)
      : undefined;
    check(
      'a rename leaves the filter key alone',
      renamed.status === 200 && still?.slug === moved,
      `slug is ${still?.slug}`,
    );
  }

  // ------------------------------------------------------------ customer ----
  console.log('\nThe customer screen’s marketing consent');
  const customers = await call<{ id: string; acceptsMarketing: boolean }[]>('/api/v1/admin/customers?pageSize=1');
  const customer = Array.isArray(customers.body) ? customers.body[0] : undefined;

  if (!customer) {
    skip('marketing consent', 'this store has no customers');
  } else {
    const was = customer.acceptsMarketing;

    const toggled = await call(`/api/v1/admin/customers/${customer.id}`, {
      method: 'PATCH',
      body: { acceptsMarketing: !was },
    });
    check('accepts a consent change', toggled.status === 200, `got ${toggled.status}`);

    const after = await call<Record<string, unknown>>(`/api/v1/admin/customers/${customer.id}`);
    check('the consent flipped', after.body.acceptsMarketing === !was, String(after.body.acceptsMarketing));

    // Put it back — this is the one record the script did not create.
    await call(`/api/v1/admin/customers/${customer.id}`, {
      method: 'PATCH',
      body: { acceptsMarketing: was },
    });
    const restored = await call<Record<string, unknown>>(`/api/v1/admin/customers/${customer.id}`);
    check('and was restored', restored.body.acceptsMarketing === was);
  }

  // ------------------------------------------------------- category icon ----
  /*
   * The glyph the storefront draws beside a department in its category rail.
   *
   * Stored on the design as `header_configuration.categoryIcons`, keyed by the
   * category's **slug**, and read straight back out as `categoryMenu[].iconKey`
   * — so this asserts both ends: that the admin write lands, and that the
   * unguarded storefront config is what actually carries it to the shop.
   *
   * `PUT /website/design` keeps any key the body omits, which is what lets this
   * panel save without sending the header links it does not edit — and is also
   * why clearing an icon only clears when the field is genuinely present.
   */
  console.log('\nThe design screen’s category icons');
  const design = await call<{
    templateKey: string;
    colorThemeKey: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    tagline: string | null;
    announcement: unknown;
    categoryIcons: Record<string, string>;
    categoryIconKeys: string[];
  }>('/api/v1/admin/website/design');

  check('the design screen answers', design.status === 200, `got ${design.status}`);
  check('it offers a closed set of glyphs', (design.body.categoryIconKeys?.length ?? 0) > 0);

  const menuCategories = await call<{ id: string; slug: string; parentId: string | null }[]>(
    '/api/v1/admin/categories?pageSize=100',
  );
  const department = (menuCategories.body ?? []).find((row) => !row.parentId);

  if (!department) {
    skip('a category icon round-trips', 'the store has no top-level category');
  } else {
    const wasIcons = design.body.categoryIcons ?? {};
    const glyph = design.body.categoryIconKeys.includes('grocery')
      ? 'grocery'
      : design.body.categoryIconKeys[0];

    // Everything the screen sends, so the check fails on the payload the panel
    // actually posts rather than on a body no form produces.
    const putDesign = (categoryIcons: Record<string, string>) =>
      call('/api/v1/admin/website/design', {
        method: 'PUT',
        body: {
          templateKey: design.body.templateKey,
          colorThemeKey: design.body.colorThemeKey,
          logoUrl: design.body.logoUrl,
          faviconUrl: design.body.faviconUrl,
          tagline: design.body.tagline,
          announcement: design.body.announcement,
          categoryIcons,
        },
      });

    const saved = await putDesign({ ...wasIcons, [department.slug]: glyph });
    check('accepts a category icon', saved.status === 200, `got ${saved.status}`);

    const after = await call<{ categoryIcons: Record<string, string> }>('/api/v1/admin/website/design');
    check(
      'the icon saved',
      after.body.categoryIcons?.[department.slug] === glyph,
      String(after.body.categoryIcons?.[department.slug]),
    );

    const config = await call<{ categoryMenu: { slug: string; iconKey: string | null }[] }>(
      '/api/v1/storefront/config',
    );
    const entry = (config.body.categoryMenu ?? []).find((row) => row.slug === department.slug);
    check('and reaches the storefront as iconKey', entry?.iconKey === glyph, String(entry?.iconKey));

    // The design row is the second record this script did not create.
    await putDesign(wasIcons);
    const restored = await call<{ categoryIcons: Record<string, string> }>('/api/v1/admin/website/design');
    check(
      'and was restored',
      JSON.stringify(restored.body.categoryIcons ?? {}) === JSON.stringify(wasIcons),
    );
  }

  // ------------------------------------------------------------- cleanup ----
  if (KEEP) {
    console.log('\nKeeping the fixtures (--keep).');
  } else {
    console.log('\nCleaning up…');
    for (const item of bin.reverse()) {
      await call(item.path, { method: 'DELETE' });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nverify-edit-fields failed to run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
