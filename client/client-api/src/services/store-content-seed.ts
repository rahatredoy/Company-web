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
  shippingMethods,
  shippingZones,
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
 * The first thing the owner is asked to add is the first thing a visitor sees.
 */
const DEFAULT_SECTIONS = [
  {
    type: 'category_circle' as const,
    title: 'Shop by Category',
    subtitle: null,
    config: {},
    sortOrder: 10,
  },
  {
    type: 'product_grid' as const,
    title: 'New Arrivals',
    subtitle: 'The latest additions to the store',
    config: { source: 'new_arrivals', limit: 8 },
    sortOrder: 20,
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
    type: 'product_carousel' as const,
    title: 'Best Sellers',
    subtitle: 'What other customers are buying',
    config: { source: 'best_selling', limit: 12 },
    sortOrder: 40,
  },
  {
    type: 'brands' as const,
    title: 'Brands We Carry',
    subtitle: null,
    config: {},
    sortOrder: 50,
  },
  {
    type: 'newsletter' as const,
    title: 'Stay in the loop',
    subtitle: 'New arrivals and offers, no more than once a week.',
    config: {},
    sortOrder: 60,
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

  if (header) {
    await db.insert(navigationItems).values([
      { menuId: header.id, label: 'Home', targetType: 'url', targetValue: '/', sortOrder: 10 },
      { menuId: header.id, label: 'Shop', targetType: 'url', targetValue: '/shop', sortOrder: 20 },
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
 * A default warehouse, zone and shipping method.
 *
 * Stock is counted against a warehouse and a shipping method hangs off a zone,
 * so without these the first order the store takes has nowhere to come from and
 * no way to reach anyone. Both are the catch-all their tables were designed
 * around — `is_default` on each.
 */
async function seedFulfilment(db: TenantDb): Promise<void> {
  await db
    .insert(warehouses)
    .values({ name: 'Main Warehouse', code: 'MAIN', isDefault: true, isActive: true })
    .onConflictDoNothing();

  const existingZone = await db.select({ id: shippingZones.id }).from(shippingZones).limit(1);
  if (existingZone.length > 0) return;

  const [zone] = await db
    .insert(shippingZones)
    .values({ name: 'Everywhere', isDefault: true, isActive: true, sortOrder: 0 })
    .returning({ id: shippingZones.id });

  if (!zone) return;

  await db.insert(shippingMethods).values({
    zoneId: zone.id,
    name: 'Standard Delivery',
    description: 'Arrives in 3–5 working days.',
    price: '0',
    estimatedDaysMin: 3,
    estimatedDaysMax: 5,
    isActive: true,
    sortOrder: 0,
  });
}
