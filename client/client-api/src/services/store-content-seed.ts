import { eq, sql } from 'drizzle-orm';
import type { TenantDb } from '../db/tenant-manager';
import {
  faqs,
  homepageSections,
  navigationItems,
  navigationMenus,
  pages,
  paymentMethods,
  platformSync,
  storeSettings,
  warehouses,
} from '../db/schema/index';
import { logger } from '../lib/logger';

/**
 * Bump to re-seed. A store already at this version is left completely alone.
 *
 * The version — rather than "is the table empty?" — is the whole point. An owner
 * who deletes the pages they did not want has an empty table, and emptiness as
 * the trigger would put every one of them back on the next request, for ever.
 * Deleting seeded content has to be a decision that sticks.
 */
export const CONTENT_SEED_VERSION = '1.0.0';

const SEED_KEY = 'content_seed_version';

/**
 * Policy pages every shop needs, with the `systemKey` the storefront links by.
 *
 * `title` and `excerpt` are **plain text** — they are rendered as text, so an
 * HTML entity here would be shown literally in the footer. Only `bodyHtml` is
 * markup, and only that column is sanitised on write.
 */
const DEFAULT_PAGES = [
  {
    slug: 'about',
    systemKey: 'about',
    title: 'About Us',
    excerpt: 'Who we are and what we sell.',
    bodyHtml:
      '<p>Welcome to our store. We are a small team who care about the things we sell and the people we sell them to.</p><p>Replace this page from your admin panel under Website → Pages.</p>',
  },
  {
    slug: 'contact',
    systemKey: 'contact',
    title: 'Contact Us',
    excerpt: 'How to reach us.',
    bodyHtml:
      '<p>Questions about an order, a product, or a return? Send us a message and we will get back to you.</p>',
  },
  {
    slug: 'privacy-policy',
    systemKey: 'privacy_policy',
    title: 'Privacy Policy',
    excerpt: 'What we collect and why.',
    bodyHtml:
      '<p>We collect only what we need to take your order and deliver it: your name, contact details and delivery address.</p><p>We do not sell your data. Replace this page with your own policy before you start trading.</p>',
  },
  {
    slug: 'terms',
    systemKey: 'terms',
    title: 'Terms & Conditions',
    excerpt: 'The terms you agree to when you order.',
    bodyHtml:
      '<p>By placing an order you agree to these terms. Replace this page with your own before you start trading.</p>',
  },
  {
    slug: 'returns-policy',
    systemKey: 'returns_policy',
    title: 'Returns & Refunds',
    excerpt: 'How to return something.',
    bodyHtml:
      '<p>If something is not right, contact us within 7 days of delivery and we will arrange a return or a replacement.</p><p>Set your own return window from your admin panel.</p>',
  },
  {
    slug: 'shipping-policy',
    systemKey: 'shipping_policy',
    title: 'Shipping & Delivery',
    excerpt: 'How and when your order arrives.',
    bodyHtml: '<p>Orders are dispatched within 1–2 working days. Delivery times vary by location.</p>',
  },
] as const;

const DEFAULT_FAQS = [
  {
    question: 'How long does delivery take?',
    answer: 'Orders are dispatched within 1–2 working days and usually arrive within 3–5 days.',
    category: 'Delivery',
  },
  {
    question: 'Can I return an item?',
    answer: 'Yes. Contact us within 7 days of delivery and we will arrange a return or a replacement.',
    category: 'Returns',
  },
  {
    question: 'How do I track my order?',
    answer: 'Use the Track Order page with your order number and the email you ordered with.',
    category: 'Orders',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'Cash on delivery is available now. More methods can be switched on from the admin panel.',
    category: 'Payment',
  },
] as const;

/**
 * The homepage a store opens with.
 *
 * Every product block names a `source` rather than a list of ids, so the shop
 * fills itself in as the owner adds products — see `home.routes.ts`. A seeded
 * list of ids would have been empty for ever, since there is nothing to name on
 * the day the store is created.
 *
 * There is no `hero` block: a hero needs an image, and one shipped from here
 * would be a stock photo of somebody else's shop on the front page of theirs.
 *
 * The two `banner` blocks are the advertising breaks between the product rows,
 * and they are seeded **empty on purpose**. They name a placement rather than
 * carrying artwork, so each is invisible until the owner adds a banner at
 * `/banners` and becomes a full-width strip the moment they do — the panel has
 * no homepage editor, so a block has to be here already to be filled. That is
 * the same reason there is no hero here, arrived at from the other side: a
 * block that needs a picture ships without one, rather than with somebody
 * else's.
 */
const DEFAULT_SECTIONS = [
  {
    type: 'category_circle' as const,
    title: 'Shop by Category',
    subtitle: null,
    config: {},
    sortOrder: 10,
  },
  /*
   * The shop itself, one department at a time, spread down the page.
   *
   * The rail above lists departments and stops there, so every aisle in the shop
   * — and on a broad catalogue that is most of it — is reachable only by opening
   * a department first and reading a second menu. A `showProducts` block draws
   * one department as a panel instead: a row of products per aisle, three of them
   * stacked, with every aisle in the department offered as a chip above.
   *
   * `showProducts` rather than `showSubcategories`, which is the same block
   * printing those aisles as a tree of links. The tree answers "how is this shop
   * filed" when the question a visitor arrives with is "what do you sell" — a
   * shopper recognises a phone on sight and has to *read* the word Smartphones.
   * The directory is still rendered for a store that asks for it, and
   * `scripts/show-products-under-categories.ts` moved the stores seeded before
   * this existed.
   *
   * **Four blocks rather than one drawing four departments**, because stacking
   * them puts the whole shop in one place: four panels between two banners reads
   * as a catalogue dump and buries whatever follows. Spread instead — a
   * department, then a promo, then a rail, then the next department — so every
   * product on the page arrives beside something unlike it.
   *
   * `offset` is what keeps two of them from drawing the same department, and it
   * is an offset rather than a category id because **this store has no
   * categories yet**: an id would have to be filled in by hand later, an offset
   * fills itself in as the owner builds the shop. A block whose department does
   * not exist renders nothing at all, so a shop with two departments simply shows
   * two panels.
   *
   * `scripts/drop-duplicate-category-blocks.ts` knows these are not the rail
   * again and leaves them alone; `scripts/distribute-category-blocks.ts` is what
   * gives the same shape to a homepage that was built before it.
   */
  {
    type: 'category_grid' as const,
    title: null,
    subtitle: null,
    config: { showProducts: true, limit: 1, offset: 0 },
    sortOrder: 15,
  },
  {
    type: 'product_grid' as const,
    title: 'New Arrivals',
    subtitle: 'The latest additions to the store',
    config: { source: 'new_arrivals', limit: 8 },
    sortOrder: 20,
  },
  {
    /*
     * The advertising break between two rows of products.
     *
     * `bannerPosition` rather than embedded artwork, so `/banners` is the one
     * screen that edits it — and `home.routes.ts#resolveBanners` sends whatever
     * is live and in date, which is what lets a campaign start and finish
     * without anyone opening this page. One wide strip rather than a row of
     * panels: a break in a scrolling page has to read as a break, and three
     * cards side by side read as another row of things to consider.
     */
    type: 'banner' as const,
    title: null,
    subtitle: null,
    config: { bannerPosition: 'home_promo', columns: 1, ratio: 'strip' },
    sortOrder: 25,
  },
  {
    type: 'benefits' as const,
    title: null,
    subtitle: null,
    config: {
      items: [
        { title: 'Fast delivery', subtitle: 'Dispatched in 1–2 working days', icon: 'truck' },
        { title: 'Easy returns', subtitle: '7-day return window', icon: 'refresh' },
        { title: 'Secure checkout', subtitle: 'Your details stay private', icon: 'shield' },
        { title: 'Here to help', subtitle: 'Questions answered quickly', icon: 'support' },
      ],
    },
    sortOrder: 30,
  },
  {
    type: 'category_grid' as const,
    title: null,
    subtitle: null,
    config: { showProducts: true, limit: 1, offset: 1 },
    sortOrder: 35,
  },
  {
    type: 'product_carousel' as const,
    title: 'Best Sellers',
    subtitle: 'What other customers are buying',
    config: { source: 'best_selling', limit: 12 },
    sortOrder: 40,
  },
  {
    // The block that shows the rest of the shop. Every other product block
    // answers a question — newest, best selling — and a product that answers
    // none of them would otherwise never reach the homepage at all. `discover`
    // walks the whole published catalogue an hour at a time, so each of them
    // gets its turn in front of a visitor. See `home.routes.ts#resolveSource`.
    type: 'product_grid' as const,
    title: 'More to Explore',
    subtitle: 'A different part of the shop every hour',
    config: { source: 'discover', limit: 12 },
    sortOrder: 45,
  },
  {
    /*
     * The advertising break between two rows of products.
     *
     * `bannerPosition` rather than embedded artwork, so `/banners` is the one
     * screen that edits it — and `home.routes.ts#resolveBanners` sends whatever
     * is live and in date, which is what lets a campaign start and finish
     * without anyone opening this page. One wide strip rather than a row of
     * panels: a break in a scrolling page has to read as a break, and three
     * cards side by side read as another row of things to consider.
     */
    type: 'banner' as const,
    title: null,
    subtitle: null,
    config: { bannerPosition: 'home_promo', columns: 1, ratio: 'strip' },
    sortOrder: 47,
  },
  /*
   * Where "All Products" used to be — the whole catalogue behind a Load more
   * button, and the longest thing on the page.
   *
   * It existed because nothing else here showed the shop rather than answering a
   * question about it, so a visitor who simply wanted to see what was for sale
   * had to work out that `/shop` exists. The department panels are that answer
   * now, and they give it aisle by aisle instead of as one undifferentiated wall
   * of products. The storefront still renders a `feed` block for a store that
   * adds one from the panel — it is only no longer what a new store opens with.
   */
  {
    type: 'category_grid' as const,
    title: null,
    subtitle: null,
    config: { showProducts: true, limit: 1, offset: 2 },
    sortOrder: 48,
  },
  {
    type: 'brands' as const,
    title: 'Brands We Carry',
    subtitle: null,
    config: {},
    sortOrder: 50,
  },
  {
    type: 'category_grid' as const,
    title: null,
    subtitle: null,
    config: { showProducts: true, limit: 1, offset: 3 },
    sortOrder: 55,
  },
] as const;

async function alreadySeeded(db: TenantDb): Promise<boolean> {
  const [row] = await db
    .select({ value: platformSync.value })
    .from(platformSync)
    .where(eq(platformSync.key, SEED_KEY))
    .limit(1);

  return (row?.value as { version?: string } | undefined)?.version === CONTENT_SEED_VERSION;
}

/**
 * Gives a freshly provisioned store a shop that looks like one.
 *
 * Company provisioning creates three tables and an owner row; nothing else. A
 * store opened on that alone renders a page with no navigation, no policies, no
 * payment method and no homepage — which reads as a broken deployment rather
 * than an empty catalogue, and leaves the owner with nowhere obvious to start.
 *
 * Every insert is `onConflictDoNothing` on the natural key, so this cannot
 * disturb a store that already has content of its own — a tenant migrated in, or
 * one seeded by an earlier version.
 */
export async function seedDefaultContent(db: TenantDb): Promise<void> {
  if (await alreadySeeded(db)) return;

  const [settings] = await db.select({ storeName: storeSettings.storeName }).from(storeSettings).limit(1);
  const storeName = settings?.storeName ?? 'Our Store';

  await db.insert(pages).values(
    DEFAULT_PAGES.map((page, index) => ({
      slug: page.slug,
      systemKey: page.systemKey,
      title: page.title,
      excerpt: page.excerpt,
      bodyHtml: page.bodyHtml,
      status: 'published' as const,
      showInFooter: true,
      sortOrder: index * 10,
      publishedAt: new Date(),
    })),
  ).onConflictDoNothing();

  await db.insert(faqs).values(
    DEFAULT_FAQS.map((faq, index) => ({ ...faq, sortOrder: index * 10 })),
  ).onConflictDoNothing();

  await db.insert(homepageSections).values([...DEFAULT_SECTIONS]).onConflictDoNothing();

  await seedNavigation(db, storeName);

  // Cash on delivery is the one method that needs no gateway account, so it is
  // the only one that can be switched on for a store nobody has configured yet.
  await db
    .insert(paymentMethods)
    .values({
      provider: 'cod',
      label: 'Cash on Delivery',
      description: 'Pay with cash when your order arrives.',
      isEnabled: true,
      sortOrder: 0,
    })
    .onConflictDoNothing();

  await seedFulfilment(db);

  await db
    .insert(platformSync)
    .values({ key: SEED_KEY, value: { version: CONTENT_SEED_VERSION, appliedAt: new Date().toISOString() } })
    .onConflictDoUpdate({
      target: platformSync.key,
      set: { value: { version: CONTENT_SEED_VERSION, appliedAt: new Date().toISOString() }, syncedAt: sql`now()` },
    });

  logger.info({ version: CONTENT_SEED_VERSION }, 'seeded default storefront content');
}

/**
 * Header and footer menus.
 *
 * Footer entries point at pages by **id**, not by path, because that is what
 * `navigation_target_type = 'page'` means and what lets a page be renamed
 * without every link to it breaking.
 */
async function seedNavigation(db: TenantDb, storeName: string): Promise<void> {
  const existing = await db.select({ id: navigationMenus.id }).from(navigationMenus).limit(1);
  if (existing.length > 0) return;

  const [header] = await db
    .insert(navigationMenus)
    .values({ name: `${storeName} header`, location: 'header', isActive: true })
    .returning({ id: navigationMenus.id });

  const [footer] = await db
    .insert(navigationMenus)
    .values({ name: `${storeName} footer`, location: 'footer', isActive: true })
    .returning({ id: navigationMenus.id });

  /*
   * No "Shop" entry. It pointed at `/shop`, which is the same catalogue
   * "Categories" opens onto, so the header offered one destination twice —
   * and only the categories entry says anything about what is inside it. The
   * `/shop` page itself stays: the empty cart, the order receipt and the 404
   * all send a shopper to it.
   */
  if (header) {
    await db.insert(navigationItems).values([
      { menuId: header.id, label: 'Home', targetType: 'url', targetValue: '/', sortOrder: 10 },
      { menuId: header.id, label: 'Categories', targetType: 'url', targetValue: '/categories', sortOrder: 30 },
      { menuId: header.id, label: 'Brands', targetType: 'url', targetValue: '/brands', sortOrder: 40 },
      { menuId: header.id, label: 'Contact', targetType: 'url', targetValue: '/contact', sortOrder: 50 },
    ]);
  }

  if (footer) {
    const pageRows = await db
      .select({ id: pages.id, slug: pages.slug, title: pages.title })
      .from(pages)
      .where(eq(pages.status, 'published'));

    const bySlug = new Map(pageRows.map((page) => [page.slug, page]));
    const footerLinks = ['about', 'contact', 'privacy-policy', 'terms', 'returns-policy', 'shipping-policy'];

    const items = footerLinks
      .map((slug, index) => {
        const page = bySlug.get(slug);
        return page
          ? {
              menuId: footer.id,
              label: page.title,
              targetType: 'page' as const,
              targetValue: page.id,
              sortOrder: index * 10,
            }
          : null;
      })
      .filter((item) => item !== null);

    if (items.length > 0) await db.insert(navigationItems).values(items);
  }
}

/**
 * The default warehouse.
 *
 * Stock is counted against a warehouse, so without one the first order the
 * store takes has nowhere to come from. It is the catch-all the table was
 * designed around — `is_default`.
 */
async function seedFulfilment(db: TenantDb): Promise<void> {
  await db
    .insert(warehouses)
    .values({ name: 'Main Warehouse', code: 'MAIN', isDefault: true, isActive: true })
    .onConflictDoNothing();
}
