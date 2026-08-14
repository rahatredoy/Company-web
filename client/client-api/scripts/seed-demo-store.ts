/**
 * Fills a store with a shopfront worth looking at.
 *
 *   npx tsx scripts/seed-demo-store.ts --slug e-comarch --email you@store.com --password '…'
 *   npx tsx scripts/seed-demo-store.ts --email you@store.com --password '…'          # the dev store
 *   npx tsx scripts/seed-demo-store.ts --email you@store.com --password '…' --reset  # undo a previous run
 *
 * `--email` is not optional, whatever a store's admin count is: `POST
 * /admin/auth/login` validates it as a required string, so omitting it sent
 * `{ password }` alone and failed on `VALIDATION_FAILED` after the run had
 * already printed that it was seeding — which reads as the seed breaking rather
 * than as an argument being missing.
 *
 * A newly provisioned store gets navigation, policy pages, a payment method and
 * a shipping method — everything except anything to *sell*. So the storefront
 * renders correctly and looks empty, which is indistinguishable from broken when
 * you are trying to build against it.
 *
 * What this produces is the reference storefront from `client-website-design.md`:
 * a hero with a campaign medallion, department circles, the trust strip, a live
 * deal beside promo panels, the four-way product tab bar, a brand row and the
 * newsletter band — all of it real rows in the tenant database, arranged by the
 * same homepage-section table the owner edits.
 *
 * Everything the admin API can do goes through the admin API rather than SQL:
 * slugs are derived by the same code a form would use, stock moves through the
 * same conditional UPDATE and leaves the same ledger rows, and the storefront
 * cache is invalidated by the same hook. Seeding straight into the tables would
 * produce data the application itself would never have written.
 *
 * Two things have no admin endpoint by design and are written directly:
 * **reviews**, which only ever come from customers, and **sold counts**, which
 * only ever move on dispatch. Both are what a demo needs and neither is
 * something an admin is allowed to invent through the panel.
 *
 * Images come from loremflickr on a fixed keyword and seed, so a product keeps
 * the same photograph between runs, the subject matches what is being sold, and
 * nothing here needs an upload or a bucket.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
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
if (!EMAIL || !PASSWORD) {
  // Checked together and before anything else, so a missing argument is refused
  // here rather than sixty lines later as a validation error from the login.
  console.error('Pass the store admin login: --email "…" --password "…".');
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
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }

  let body: any = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    body = result.text;
  }

  return { status: result.status, body };
}

/**
 * A photograph of roughly the right thing.
 *
 * The keyword is what makes the demo readable — a random 600×600 under
 * "Wireless Headphones" reads as a broken catalogue, whereas a picture of some
 * headphones reads as a shop. `lock` pins one image per seed so a product keeps
 * its photograph between runs.
 */
const photo = (keyword: string, seed: number, size = 600) =>
  `https://loremflickr.com/${size}/${size}/${encodeURIComponent(keyword)}?lock=${seed}`;

const wide = (keyword: string, seed: number) =>
  `https://loremflickr.com/1200/675/${encodeURIComponent(keyword)}?lock=${seed}`;

// ------------------------------------------------------------------ data ----

/**
 * Twelve departments, so the category rail overflows and offers "More
 * Categories" — a store with exactly as many categories as fit is not the case
 * the sidebar was built for.
 */
/**
 * Twelve departments, each with the aisles beneath it.
 *
 * Two levels, because one level is not a catalogue: the mega menu draws its
 * dropdown columns from `children`, the sidebar opens a flyout from them, and a
 * category page renders them as the chips that narrow it. With a flat list all
 * three render nothing and the navigation looks broken rather than empty.
 *
 * Products hang off the **child**, never the parent. `descendantIds` in the
 * listing service resolves a category to its whole subtree, so a product filed
 * under "Smartphones" appears on `/category/smartphones` *and* on
 * `/category/electronics` — which is what makes both levels work without
 * filing anything twice.
 */
const CATEGORIES = [
  {
    key: 'electronics', name: 'Electronics', keyword: 'electronics',
    children: [
      { key: 'smartphones', name: 'Smartphones', keyword: 'smartphone' },
      { key: 'laptops', name: 'Laptops & Computers', keyword: 'laptop' },
      { key: 'cameras', name: 'Cameras', keyword: 'camera' },
      { key: 'audio', name: 'Audio & Headphones', keyword: 'headphones' },
      { key: 'tv', name: 'TV & Home Cinema', keyword: 'television' },
      { key: 'printers', name: 'Printers & Scanners', keyword: 'printer' },
    ],
  },
  {
    key: 'fashion', name: 'Fashion', keyword: 'fashion clothing',
    children: [
      { key: 'mens', name: "Men's Clothing", keyword: 'menswear' },
      { key: 'womens', name: "Women's Clothing", keyword: 'womenswear' },
      { key: 'shoes', name: 'Shoes & Trainers', keyword: 'sneakers' },
      { key: 'watches', name: 'Watches', keyword: 'wristwatch' },
      { key: 'bags', name: 'Bags & Accessories', keyword: 'handbag' },
    ],
  },
  {
    key: 'home', name: 'Home & Kitchen', keyword: 'kitchen',
    children: [
      { key: 'kitchen-appliances', name: 'Kitchen Appliances', keyword: 'kitchen appliance' },
      { key: 'cookware', name: 'Cookware & Dining', keyword: 'cookware' },
      { key: 'bedding', name: 'Bedding & Mattresses', keyword: 'bedding' },
      { key: 'decor', name: 'Home Decor', keyword: 'home decor' },
    ],
  },
  {
    key: 'beauty', name: 'Beauty & Personal Care', keyword: 'cosmetics',
    children: [
      { key: 'skincare', name: 'Skincare', keyword: 'skincare' },
      { key: 'haircare', name: 'Hair Care', keyword: 'hair care' },
      { key: 'grooming', name: 'Shaving & Grooming', keyword: 'shaving' },
      { key: 'fragrance', name: 'Fragrance', keyword: 'perfume' },
    ],
  },
  {
    key: 'sports', name: 'Sports & Outdoors', keyword: 'sports',
    children: [
      { key: 'fitness', name: 'Fitness Equipment', keyword: 'fitness' },
      { key: 'backpacks', name: 'Bags & Backpacks', keyword: 'backpack' },
      { key: 'hydration', name: 'Bottles & Hydration', keyword: 'water bottle' },
      { key: 'camping', name: 'Camping & Hiking', keyword: 'camping' },
    ],
  },
  {
    key: 'toys', name: 'Toys & Games', keyword: 'toys',
    children: [
      { key: 'building-toys', name: 'Building Toys', keyword: 'building blocks' },
      { key: 'rc-toys', name: 'Remote Control', keyword: 'remote control car' },
      { key: 'board-games', name: 'Board Games', keyword: 'board game' },
    ],
  },
  {
    key: 'tools', name: 'Tools & Home Improvement', keyword: 'tools',
    children: [
      { key: 'power-tools', name: 'Power Tools', keyword: 'power drill' },
      { key: 'hand-tools', name: 'Hand Tools', keyword: 'hand tools' },
      { key: 'tool-storage', name: 'Tool Storage', keyword: 'toolbox' },
    ],
  },
  {
    key: 'automotive', name: 'Automotive', keyword: 'car',
    children: [
      { key: 'car-electronics', name: 'Car Electronics', keyword: 'dash cam' },
      { key: 'car-care', name: 'Car Care & Cleaning', keyword: 'car cleaning' },
      { key: 'car-accessories', name: 'Car Accessories', keyword: 'car accessories' },
    ],
  },
  {
    key: 'books', name: 'Books & Stationery', keyword: 'books',
    children: [
      { key: 'fiction', name: 'Fiction', keyword: 'novel' },
      { key: 'non-fiction', name: 'Non-Fiction', keyword: 'books' },
      { key: 'stationery', name: 'Notebooks & Stationery', keyword: 'notebook' },
    ],
  },
  {
    key: 'health', name: 'Health & Wellness', keyword: 'wellness',
    children: [
      { key: 'supplements', name: 'Vitamins & Supplements', keyword: 'vitamins' },
      { key: 'wellness-devices', name: 'Health Devices', keyword: 'health device' },
      { key: 'yoga', name: 'Yoga & Meditation', keyword: 'yoga' },
    ],
  },
  {
    key: 'pets', name: 'Pet Supplies', keyword: 'pet',
    children: [
      { key: 'dog', name: 'Dog Supplies', keyword: 'dog' },
      { key: 'cat', name: 'Cat Supplies', keyword: 'cat' },
      { key: 'pet-accessories', name: 'Pet Accessories', keyword: 'pet accessories' },
    ],
  },
  {
    key: 'garden', name: 'Garden & Outdoor', keyword: 'garden',
    children: [
      { key: 'garden-tools', name: 'Garden Tools', keyword: 'garden tools' },
      { key: 'outdoor-furniture', name: 'Outdoor Furniture', keyword: 'garden furniture' },
      { key: 'plants', name: 'Plants & Seeds', keyword: 'plants' },
    ],
  },
];

/**
 * Eight brands, each with a mark.
 *
 * They carried no `logoUrl` and the strip fell back to the name set in type,
 * which is a legitimate state for a store that has uploaded nothing — but it
 * meant the logo path itself was never exercised, so nobody saw that a brand
 * row is a different shape with an image in it. Seeding both is not an option
 * here, and a shop with logos is the more useful thing to be looking at.
 */
const BRANDS = [
  { key: 'apple', name: 'Apple', keyword: 'apple logo' },
  { key: 'samsung', name: 'Samsung', keyword: 'samsung logo' },
  { key: 'sony', name: 'Sony', keyword: 'sony logo' },
  { key: 'nike', name: 'Nike', keyword: 'nike logo' },
  { key: 'canon', name: 'Canon', keyword: 'canon camera logo' },
  { key: 'adidas', name: 'adidas', keyword: 'adidas logo' },
  { key: 'puma', name: 'Puma', keyword: 'puma logo' },
  { key: 'philips', name: 'Philips', keyword: 'philips logo' },
];

/**
 * The store's own profiles, service strip, thumb bar and department glyphs.
 *
 * All four of these were constants in the storefront until now, rendered
 * identically for every shop on the platform — which is why the footer linked
 * to `facebook.com` itself and every category in the sidebar showed a t-shirt.
 * They are store data, so they are seeded as store data.
 */
const SOCIAL = [
  { platform: 'facebook', url: 'https://facebook.com/shopmart' },
  { platform: 'instagram', url: 'https://instagram.com/shopmart' },
  { platform: 'x', url: 'https://x.com/shopmart' },
  { platform: 'youtube', url: 'https://youtube.com/@shopmart' },
  { platform: 'tiktok', url: 'https://tiktok.com/@shopmart' },
];

const UTILITY = [
  { label: 'Track Your Order', href: '/track-order' },
  { label: 'Help Center', href: '/faq' },
  { label: 'Contact Us', href: '/contact' },
];

const MOBILE_NAV = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Categories', href: '/categories', icon: 'categories' },
  { label: 'Shop', href: '/shop', icon: 'shop' },
  { label: 'Wishlist', href: '/wishlist', icon: 'wishlist' },
  { label: 'Account', href: '/account', icon: 'account' },
];

/**
 * Footer columns.
 *
 * Every href is a route that exists — checked against `app/`, because the fixed
 * arrays these replace shipped a link to `/page/return-policy` when the seeded
 * slug is `returns-policy`, and it 404'd on every store on the platform for as
 * long as it was there. The policy column is *not* here: it is derived from the
 * pages the store has actually published, so it cannot go stale the same way.
 */
const FOOTER_COLUMNS = [
  {
    id: 'shop',
    title: 'Shop',
    links: [
      { label: 'All Products', href: '/shop' },
      { label: 'New Arrivals', href: '/new-arrivals' },
      { label: 'Best Sellers', href: '/best-sellers' },
      { label: 'On Sale', href: '/sale' },
      { label: 'Brands', href: '/brands' },
    ],
  },
  {
    id: 'service',
    title: 'Customer Service',
    links: [
      { label: 'Contact Us', href: '/contact' },
      { label: 'FAQs', href: '/faq' },
      { label: 'Track Your Order', href: '/track-order' },
      { label: 'Compare Products', href: '/compare' },
    ],
  },
  {
    id: 'account',
    title: 'My Account',
    links: [
      { label: 'My Orders', href: '/account/orders' },
      { label: 'Wishlist', href: '/wishlist' },
      { label: 'Account Details', href: '/account/profile' },
      { label: 'Addresses', href: '/account/addresses' },
      { label: 'Returns', href: '/account/returns' },
    ],
  },
];

/**
 * Banner rows for the two homepage placements.
 *
 * `linkUrl` is an internal path on every one of them: `readInternalHref` in the
 * storefront drops anything that is not, so an absolute URL here would render a
 * banner whose button goes nowhere.
 */
const BANNERS = [
  {
    title: 'Mid-Season Clearance',
    subtitle: 'Up to 60% off across electronics and home',
    imageUrl: wide('sale shopping', 31),
    mobileImageUrl: photo('sale shopping', 31, 800),
    linkUrl: '/sale',
    buttonLabel: 'Shop the Sale',
    position: 'home_hero',
    isActive: true,
    sortOrder: 0,
  },
  {
    title: 'Tech Upgrade Week',
    subtitle: 'Laptops, phones and audio at their lowest this season',
    imageUrl: wide('laptop desk', 32),
    mobileImageUrl: photo('laptop desk', 32, 800),
    linkUrl: '/category/electronics',
    buttonLabel: 'Explore Tech',
    position: 'home_promo',
    isActive: true,
    sortOrder: 10,
  },
  {
    title: 'Home Refresh',
    subtitle: 'Kitchen, bedding and decor for the new season',
    imageUrl: wide('home interior', 33),
    mobileImageUrl: photo('home interior', 33, 800),
    linkUrl: '/category/home-kitchen',
    buttonLabel: 'Shop Home',
    position: 'home_promo',
    isActive: true,
    sortOrder: 20,
  },
  {
    title: 'Everyday Essentials',
    subtitle: 'Restock the basics for less',
    imageUrl: wide('grocery basket', 34),
    mobileImageUrl: photo('grocery basket', 34, 800),
    linkUrl: '/shop',
    buttonLabel: 'Browse All',
    position: 'home_promo',
    isActive: true,
    sortOrder: 30,
  },
];

/**
 * Curated collections, by the SKUs in them.
 *
 * SKUs rather than category membership: a collection is an editorial grouping
 * that cuts across the taxonomy — "Work From Home" wants a laptop, a chair and
 * a desk lamp, which is exactly the selection no category can express.
 */
const COLLECTIONS = [
  {
    name: 'Work From Home',
    slug: 'work-from-home',
    description: 'Everything for a desk you actually want to sit at.',
    keyword: 'home office desk',
    seed: 41,
    // MacBook, headphones, printer, AirPods, coffee maker, water bottle.
    skus: ['SM-009', 'SM-007', 'SM-012', 'SM-010', 'SM-018', 'SM-025'],
  },
  {
    name: 'Summer Essentials',
    slug: 'summer-essentials',
    description: 'Light, packable and ready for the season.',
    keyword: 'summer beach',
    seed: 42,
    // Shorts, tee, backpack, yoga mat, trainers, bottle.
    skus: ['SM-016', 'SM-015', 'SM-006', 'SM-024', 'SM-002', 'SM-025'],
  },
  {
    /*
     * The name is a price claim, so every SKU in it is checked against its own
     * price at seed time and dropped if it does not qualify — a collection that
     * promises "under $100" and lists a $249 airfryer is the kind of thing
     * nobody notices until a customer does.
     */
    name: 'Gifts Under $100',
    slug: 'gifts-under-100',
    description: 'Thoughtful, and none of them break the budget.',
    keyword: 'gift box',
    seed: 43,
    maxPrice: 100,
    skus: ['SM-015', 'SM-022', 'SM-024', 'SM-025', 'SM-020', 'SM-027', 'SM-029', 'SM-023'],
  },
];

/**
 * The running flash sale.
 *
 * A real row with a real window, because the countdown reads `ends_at` from the
 * campaign now. The window is written relative to the moment of seeding and
 * runs for three days — long enough that a demo does not expire overnight,
 * finite because a countdown that never ends is the thing this replaced.
 */
const FLASH_SALE = {
  name: 'Weekend Flash Sale',
  hours: 72,
  /**
   * SKU → the price it goes at while the campaign runs.
   *
   * Every one is below that product's list price, checked at seed time. A flash
   * price at or above list is not a discount, and the card would render a
   * saving badge for it regardless.
   */
  items: [
    { sku: 'SM-001', price: '849.00' }, // iPhone 14 Pro Max, list 999
    { sku: 'SM-004', price: '399.00' }, // Canon EOS 250D, list 499
    { sku: 'SM-005', price: '129.00' }, // Fossil watch, list 179
    { sku: 'SM-014', price: '39.00' }, // Puma hoodie, list 59
    { sku: 'SM-018', price: '64.00' }, // Philips coffee maker, list 89
    { sku: 'SM-023', price: '42.00' }, // Hair dryer, list 59
    { sku: 'SM-028', price: '69.00' }, // Cordless drill, list 89
    { sku: 'SM-031', price: '32.00' }, // Car vacuum, list 45
  ],
};

/** Department slug → glyph key, from the storefront's closed set. */
const CATEGORY_ICONS: Record<string, string> = {
  electronics: 'electronics',
  fashion: 'fashion',
  'home-kitchen': 'home',
  'beauty-personal-care': 'beauty',
  'sports-outdoors': 'sports',
  'toys-games': 'toys',
  'tools-home-improvement': 'tools',
  automotive: 'automotive',
  'books-stationery': 'books',
  'health-wellness': 'health',
  'pet-supplies': 'pets',
  'garden-outdoor': 'garden',
};

/**
 * The filterable vocabulary.
 *
 * `isVariantAttribute` is false throughout: these describe a product so a
 * listing can be narrowed by them, which is a different job from splitting one
 * product into several buyable variants. Colour carries hex values so the
 * storefront draws swatches rather than checkboxes.
 */
const ATTRIBUTES = [
  {
    key: 'colour',
    name: 'Colour',
    inputType: 'color' as const,
    values: [
      { value: 'Black', colorHex: '#111827' },
      { value: 'White', colorHex: '#F9FAFB' },
      { value: 'Silver', colorHex: '#C0C5CE' },
      { value: 'Blue', colorHex: '#2563EB' },
      { value: 'Red', colorHex: '#DC2626' },
      { value: 'Green', colorHex: '#059669' },
    ],
  },
  {
    key: 'size',
    name: 'Size',
    inputType: 'select' as const,
    values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }, { value: 'XL' }],
  },
  {
    key: 'material',
    name: 'Material',
    inputType: 'select' as const,
    values: [
      { value: 'Aluminium' },
      { value: 'Cotton' },
      { value: 'Leather' },
      { value: 'Plastic' },
      { value: 'Stainless Steel' },
    ],
  },
  {
    key: 'storage',
    name: 'Storage',
    inputType: 'select' as const,
    values: [{ value: '128GB' }, { value: '256GB' }, { value: '512GB' }],
  },
];

/**
 * One buyable combination of a variable product.
 *
 * The first entry deliberately carries no `suffix`, so it keeps the product's
 * original SKU: the variants endpoint matches on SKU, so that row is updated in
 * place and holds on to the stock the opening adjustment gave it.
 */
interface DemoVariant {
  suffix?: string;
  /** `Attribute:Value` pairs, e.g. `Storage:256GB`. */
  options: string[];
  price?: string;
  salePrice?: string;
  stock: number;
}

interface DemoProduct {
  name: string;
  category: string;
  brand?: string;
  price: string;
  salePrice?: string;
  cost: string;
  stock: number;
  keyword: string;
  featured?: boolean;
  newArrival?: boolean;
  /** Descriptive attribute values, as `Attribute:Value` pairs. */
  attributes?: string[];
  /** Present on a `variable` product; the storefront draws option controls from it. */
  variants?: DemoVariant[];
  /** "Frequently bought together" — other products, by name. */
  bundle?: string[];
  /** Specification rows for the product tab, as `Group|Label|Value`. */
  specs?: string[];
  /** Dispatched units. Written directly — nothing an admin may set by hand. */
  sold?: number;
  /** How many approved reviews to write, and what they should average to. */
  reviews?: { count: number; average: number };
  short: string;
  description: string;
}

const PRODUCTS: DemoProduct[] = [
  // ---- the six the reference storefront features, in that order -------------
  {
    name: 'Apple iPhone 14 Pro Max',
    category: 'smartphones', brand: 'apple', price: '999.00', cost: '720.00',
    stock: 26, keyword: 'smartphone', featured: true, sold: 412,
    reviews: { count: 128, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Stainless Steel'],
    bundle: ['Apple AirPods Pro (2nd gen)'],
    // Storage changes the price, which is the case the variant selector exists
    // for: picking one has to move the price, the SKU and the stock together.
    variants: [
      { options: ['Storage:128GB'], price: '999.00', stock: 26 },
      { suffix: '256', options: ['Storage:256GB'], price: '1099.00', stock: 14 },
      { suffix: '512', options: ['Storage:512GB'], price: '1299.00', stock: 4 },
    ],
    specs: [
      'Display|Screen size|6.7 inches',
      'Display|Resolution|2796 x 1290 (Super Retina XDR)',
      'Display|Refresh rate|120Hz ProMotion',
      'Camera|Main camera|48MP, f/1.78',
      'Camera|Front camera|12MP TrueDepth',
      'Performance|Chip|A16 Bionic',
      'Battery|Video playback|Up to 29 hours',
      'General|Warranty|1 year limited',
    ],
    short: '6.7" Super Retina XDR, 48MP camera, A16 Bionic.',
    description:
      '<p>The 6.7-inch Super Retina XDR display goes to 2000 nits outdoors, and the 48MP main camera crops to a 2x telephoto without losing detail.</p><ul><li>6.7" Super Retina XDR, ProMotion 120Hz</li><li>48MP main + 12MP ultrawide + 12MP telephoto</li><li>A16 Bionic</li><li>Up to 29 hours video playback</li></ul>',
  },
  {
    name: 'Nike Air Max 270',
    category: 'shoes', brand: 'nike', price: '149.00', cost: '78.00',
    stock: 64, keyword: 'sneakers', featured: true, sold: 356,
    reviews: { count: 85, average: 4.5 },
    attributes: ['Colour:White', 'Material:Cotton'],
    bundle: ['Nike Sportswear T-Shirt', 'Adidas Backpack'],
    // One size sold out, so the selector has an unavailable option to disable.
    variants: [
      { options: ['Size:S'], stock: 12 },
      { suffix: 'M', options: ['Size:M'], stock: 22 },
      { suffix: 'L', options: ['Size:L'], stock: 18 },
      { suffix: 'XL', options: ['Size:XL'], stock: 0 },
    ],
    specs: [
      'Fit|Closure|Lace-up',
      'Fit|Cut|Low top',
      'Construction|Upper|Engineered mesh',
      'Construction|Midsole|Max Air 270 unit',
      'Construction|Outsole|Rubber waffle',
      'General|Warranty|2 years',
    ],
    short: "Nike's largest heel Air unit yet.",
    description:
      '<p>The 270 takes the largest heel Air unit Nike has put in a lifestyle shoe and wraps it in a stretchy upper that pulls on like a sock.</p>',
  },
  {
    name: 'KitchenAid Stand Mixer',
    category: 'kitchen-appliances', price: '349.00', cost: '210.00',
    stock: 18, keyword: 'stand mixer', featured: true, sold: 284,
    reviews: { count: 64, average: 4.0 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    specs: [
      'Capacity|Bowl|4.8 litres',
      'Performance|Speeds|10',
      'Performance|Motor|300W',
      'Construction|Body|Die-cast metal',
      'In the box|Included|Flat beater, dough hook, wire whisk',
      'General|Warranty|5 years',
    ],
    short: '4.8L bowl, 10 speeds, all-metal build.',
    description:
      '<p>A 4.8-litre bowl, ten speeds and a planetary action that reaches every part of it. The hub on the front takes the whole attachment range.</p>',
  },
  {
    name: 'Canon EOS 250D Camera',
    category: 'cameras', brand: 'canon', price: '499.00', cost: '360.00',
    stock: 12, keyword: 'dslr camera', featured: true, sold: 197,
    reviews: { count: 96, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    bundle: ['Canon PIXMA Home Printer'],
    specs: [
      'Sensor|Type|APS-C CMOS',
      'Sensor|Resolution|24.1 megapixels',
      'Video|Maximum|4K UHD at 25fps',
      'Screen|Type|3" vari-angle touchscreen',
      'Autofocus|Points|9-point AF',
      'General|Weight|449g with battery',
      'General|Warranty|2 years',
    ],
    short: '24.1MP APS-C, 4K video, vari-angle screen.',
    description:
      '<p>24.1 megapixels on an APS-C sensor, 4K video and a vari-angle touchscreen, in the lightest DSLR body Canon makes.</p>',
  },
  {
    name: "Fossil Men's Watch",
    category: 'watches', price: '179.00', cost: '92.00',
    stock: 33, keyword: 'wristwatch', featured: true, sold: 165,
    reviews: { count: 75, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Leather'],
    specs: [
      'Case|Diameter|44mm',
      'Case|Material|Stainless steel',
      'Strap|Material|Genuine leather',
      'Movement|Type|Quartz, three-hand',
      'Water resistance|Rating|50 metres',
      'General|Warranty|2 years',
    ],
    short: 'Stainless case, genuine leather strap.',
    description: '<p>A 44mm stainless steel case on a genuine leather strap, water resistant to 50 metres.</p>',
  },
  {
    name: 'Adidas Backpack',
    category: 'backpacks', brand: 'adidas', price: '59.00', cost: '27.00',
    stock: 88, keyword: 'backpack', featured: true, sold: 143,
    reviews: { count: 39, average: 4.0 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    specs: [
      'Capacity|Volume|28 litres',
      'Storage|Laptop sleeve|Fits up to 15"',
      'Construction|Fabric|Recycled polyester',
      'Construction|Base|Water-repellent coating',
      'General|Weight|620g',
      'General|Warranty|2 years',
    ],
    short: '28L, padded laptop sleeve, water-repellent.',
    description: '<p>Twenty-eight litres with a padded laptop sleeve and a water-repellent base for setting down on wet ground.</p>',
  },

  // ---- the deal ------------------------------------------------------------
  {
    name: 'Sony WH-1000XM5 Wireless Headphones',
    category: 'audio', brand: 'sony', price: '399.00', salePrice: '299.00', cost: '215.00',
    stock: 41, keyword: 'headphones', sold: 302,
    reviews: { count: 214, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    specs: [
      'Audio|Driver|30mm carbon fibre composite',
      'Audio|Frequency response|4Hz – 40,000Hz',
      'Noise cancelling|Microphones|8',
      'Battery|Playtime|30 hours (ANC on)',
      'Battery|Quick charge|3 minutes for 3 hours',
      'Connectivity|Bluetooth|5.2, multipoint',
      'General|Weight|250g',
      'General|Warranty|2 years',
    ],
    short: 'Industry-leading noise cancelling, 30-hour battery.',
    description:
      '<p>Eight microphones and two processors reading the room, thirty hours between charges, and a three-minute charge worth three hours.</p><ul><li>Adaptive noise cancelling</li><li>30-hour battery, USB-C quick charge</li><li>Multipoint pairing</li><li>Speak-to-chat</li></ul>',
  },

  // ---- electronics ---------------------------------------------------------
  {
    name: 'Samsung Galaxy S23 Ultra',
    category: 'smartphones', brand: 'samsung', price: '1199.00', salePrice: '1099.00', cost: '840.00',
    stock: 22, keyword: 'samsung phone', newArrival: true, sold: 121,
    reviews: { count: 57, average: 4.5 },
    short: '200MP camera and an S Pen in the body.',
    description: '<p>A 200MP main sensor, a 6.8-inch Dynamic AMOLED panel, and the S Pen stowed in the body rather than sold beside it.</p>',
  },
  {
    name: 'Apple MacBook Air M2',
    category: 'laptops', brand: 'apple', price: '1099.00', cost: '820.00',
    stock: 15, keyword: 'laptop', newArrival: true, sold: 96,
    reviews: { count: 48, average: 5 },
    short: '13.6" Liquid Retina, 8GB, 256GB SSD.',
    description: '<p>Fanless, 1.24kg, and rated for eighteen hours — the machine most people should buy.</p>',
  },
  {
    name: 'Apple AirPods Pro (2nd gen)',
    category: 'audio', brand: 'apple', price: '249.00', salePrice: '199.00', cost: '140.00',
    stock: 74, keyword: 'earbuds', newArrival: true, sold: 188,
    reviews: { count: 92, average: 4.5 },
    short: 'Adaptive transparency, USB-C case.',
    description: '<p>Twice the noise cancellation of the first generation, and a case that finally charges over USB-C.</p>',
  },
  {
    name: 'Samsung 55" 4K Smart TV',
    category: 'tv', brand: 'samsung', price: '649.00', salePrice: '549.00', cost: '430.00',
    stock: 9, keyword: 'television', sold: 64,
    reviews: { count: 31, average: 4 },
    short: '55-inch 4K HDR with built-in streaming.',
    description: '<p>Fifty-five inches of 4K HDR with the streaming apps built in, so nothing else needs plugging into it.</p>',
  },
  {
    // Deliberately below the low-stock threshold, so the "Only N left" band has
    // something to appear on — the third of the three stock states, alongside
    // the out-of-stock Tool Kit and everything else in stock.
    name: 'Canon PIXMA Home Printer',
    category: 'printers', brand: 'canon', price: '129.00', cost: '76.00',
    stock: 3, keyword: 'printer', sold: 41,
    reviews: { count: 18, average: 4 },
    short: 'Wireless all-in-one, print/scan/copy.',
    description: '<p>Prints, scans and copies over Wi-Fi, from a phone as readily as from a laptop.</p>',
  },

  // ---- fashion -------------------------------------------------------------
  {
    name: 'Adidas Ultraboost 22',
    category: 'shoes', brand: 'adidas', price: '179.00', salePrice: '139.00', cost: '85.00',
    stock: 52, keyword: 'running shoes', sold: 134,
    reviews: { count: 66, average: 4.5 },
    short: 'Boost midsole, knit upper.',
    description: '<p>The Boost midsole returns more of what you put into it, under a knit upper that holds the foot without pressure points.</p>',
  },
  {
    name: 'Puma Essentials Hoodie',
    category: 'mens', brand: 'puma', price: '59.00', cost: '24.00',
    stock: 96, keyword: 'hoodie', newArrival: true, sold: 78,
    reviews: { count: 27, average: 4 },
    attributes: ['Material:Cotton'],
    /*
     * Two attributes at once, and deliberately not a full matrix.
     *
     * Blue is made in S and M only, so picking Blue leaves L with no variant at
     * all — the selector strikes it through and disables it. M/Blue exists but
     * is sold out, which is the *other* state: still selectable, with the buy
     * button refusing. A complete, fully stocked grid demonstrates neither.
     */
    variants: [
      { options: ['Size:S', 'Colour:Black'], stock: 14 },
      { suffix: 'M-BK', options: ['Size:M', 'Colour:Black'], stock: 20 },
      { suffix: 'L-BK', options: ['Size:L', 'Colour:Black'], stock: 16 },
      { suffix: 'S-BL', options: ['Size:S', 'Colour:Blue'], stock: 9 },
      { suffix: 'M-BL', options: ['Size:M', 'Colour:Blue'], stock: 0 },
    ],
    short: 'Brushed fleece, ribbed cuffs.',
    description: '<p>Brushed fleece inside, ribbed cuffs and hem, and a hood that keeps its shape after washing.</p>',
  },
  {
    name: 'Nike Sportswear T-Shirt',
    category: 'mens', brand: 'nike', price: '29.00', cost: '11.00',
    stock: 140, keyword: 'tshirt', sold: 210,
    reviews: { count: 44, average: 4.5 },
    short: 'Soft cotton jersey, standard fit.',
    description: '<p>Soft cotton jersey in a standard fit, with a woven label rather than a print that cracks.</p>',
  },
  {
    name: 'Puma Running Shorts',
    category: 'mens', brand: 'puma', price: '34.00', salePrice: '24.00', cost: '13.00',
    stock: 71, keyword: 'shorts', sold: 58,
    reviews: { count: 19, average: 4 },
    short: 'Lightweight, zip pocket.',
    description: '<p>Lightweight woven fabric with a zip pocket that holds a phone without swinging.</p>',
  },

  // ---- home & kitchen ------------------------------------------------------
  {
    name: 'Philips Airfryer XXL',
    category: 'kitchen-appliances', brand: 'philips', price: '249.00', salePrice: '199.00', cost: '145.00',
    stock: 24, keyword: 'air fryer', newArrival: true, sold: 112,
    reviews: { count: 73, average: 4.5 },
    short: '7.3L, feeds a family of six.',
    description: '<p>A 7.3-litre basket — enough for a whole chicken — and a drawer that goes in the dishwasher.</p>',
  },
  {
    name: 'Philips Coffee Maker',
    category: 'kitchen-appliances', brand: 'philips', price: '89.00', cost: '47.00',
    stock: 38, keyword: 'coffee maker', sold: 67,
    reviews: { count: 25, average: 4 },
    short: 'Grinds and brews, 1.2L carafe.',
    description: '<p>Grinds the beans and brews straight into a 1.2-litre insulated carafe.</p>',
  },
  {
    name: 'Non-stick Cookware Set (10-piece)',
    category: 'cookware', price: '129.00', salePrice: '99.00', cost: '62.00',
    stock: 31, keyword: 'cookware', sold: 49,
    reviews: { count: 22, average: 4 },
    short: 'Ten pieces, induction-ready.',
    description: '<p>Ten pieces with a bonded base that works on induction, and handles that stay cool on the hob.</p>',
  },
  {
    name: 'Memory Foam Pillow (2-pack)',
    category: 'bedding', price: '45.00', cost: '19.00',
    stock: 110, keyword: 'pillow', sold: 88,
    reviews: { count: 36, average: 4.5 },
    short: 'Ventilated foam, washable covers.',
    description: '<p>Ventilated memory foam under a cover that comes off and goes in the machine.</p>',
  },

  // ---- beauty --------------------------------------------------------------
  {
    name: 'Philips Electric Shaver',
    category: 'grooming', brand: 'philips', price: '119.00', salePrice: '89.00', cost: '58.00',
    stock: 43, keyword: 'electric shaver', sold: 71,
    reviews: { count: 34, average: 4.5 },
    short: 'Wet and dry, 60-minute runtime.',
    description: '<p>Heads that flex in five directions, an hour of runtime, and it can be rinsed under the tap.</p>',
  },
  {
    name: 'Vitamin C Face Serum',
    category: 'skincare', price: '24.00', cost: '8.00',
    stock: 165, keyword: 'skincare serum', newArrival: true, sold: 143,
    reviews: { count: 51, average: 4.5 },
    short: '15% vitamin C with hyaluronic acid.',
    description: '<p>Fifteen percent vitamin C buffered with hyaluronic acid, in a bottle dark enough to keep it stable.</p>',
  },
  {
    name: 'Hair Dryer Pro 2200W',
    category: 'haircare', price: '59.00', cost: '26.00',
    stock: 57, keyword: 'hair dryer', sold: 39,
    reviews: { count: 16, average: 4 },
    short: 'Ionic, three heat settings.',
    description: '<p>Ionic conditioning, three heat settings and a cold shot that actually sets a style.</p>',
  },

  // ---- sports --------------------------------------------------------------
  {
    name: 'Yoga Mat Pro 6mm',
    category: 'fitness', price: '39.00', cost: '14.00',
    stock: 82, keyword: 'yoga mat', sold: 94,
    reviews: { count: 29, average: 4.5 },
    short: 'Six millimetres, non-slip both sides.',
    description: '<p>Six millimetres of cushioning that still lets you feel the floor, and grip on both faces.</p>',
  },
  {
    name: 'Stainless Water Bottle 1L',
    category: 'hydration', price: '19.00', cost: '6.00',
    stock: 190, keyword: 'water bottle', newArrival: true, sold: 176,
    reviews: { count: 41, average: 4.5 },
    short: 'Vacuum insulated, 24 hours cold.',
    description: '<p>Double-walled stainless steel: twenty-four hours cold, twelve hot, and no condensation on the outside.</p>',
  },

  // ---- toys ----------------------------------------------------------------
  {
    name: 'Building Blocks Set (500 pieces)',
    category: 'building-toys', price: '49.00', salePrice: '39.00', cost: '18.00',
    stock: 66, keyword: 'building blocks', sold: 83,
    reviews: { count: 32, average: 4.5 },
    short: '500 pieces, compatible with the big brands.',
    description: '<p>Five hundred pieces in a sorted tray, sized to fit the bricks already in the house.</p>',
  },
  {
    name: 'Remote Control Racing Car',
    category: 'rc-toys', price: '34.00', cost: '13.00',
    stock: 48, keyword: 'toy car', sold: 55,
    reviews: { count: 21, average: 4 },
    short: '2.4GHz, 20 minutes per charge.',
    description: '<p>Twenty minutes of running per charge, and a 2.4GHz radio so two can race without interfering.</p>',
  },

  // ---- tools ---------------------------------------------------------------
  {
    name: 'Cordless Drill 20V',
    category: 'power-tools', price: '89.00', cost: '44.00',
    stock: 35, keyword: 'power drill', sold: 61,
    reviews: { count: 28, average: 4.5 },
    short: 'Two batteries, 20 torque settings.',
    description: '<p>Two batteries in the case, so one is always charged, and twenty torque settings before the clutch slips.</p>',
  },
  {
    /*
     * Deliberately out of stock — every shop has something that is, and a demo
     * where nothing ever is leaves the out-of-stock card, the disabled
     * add-to-cart and the "Availability" facet with no way to show themselves.
     * The facet in particular is only offered when it would hide something.
     */
    name: 'Tool Kit (108 pieces)',
    category: 'hand-tools', price: '69.00', cost: '31.00',
    stock: 0, keyword: 'tool kit', sold: 37,
    reviews: { count: 15, average: 4 },
    short: 'Everything for flat-pack and repairs.',
    description: '<p>A hundred and eight pieces in a moulded case, which is the part that keeps them together.</p>',
  },

  // ---- automotive ----------------------------------------------------------
  {
    name: 'Car Dash Camera 4K',
    category: 'car-electronics', price: '99.00', salePrice: '79.00', cost: '46.00',
    stock: 29, keyword: 'dash cam', sold: 44,
    reviews: { count: 23, average: 4 },
    short: '4K front, loop recording, G-sensor.',
    description: '<p>4K to a loop, with a G-sensor that locks the clip when something happens.</p>',
  },
  {
    name: 'Portable Car Vacuum Cleaner',
    category: 'car-care', price: '45.00', cost: '19.00',
    stock: 58, keyword: 'vacuum cleaner', sold: 33,
    reviews: { count: 17, average: 4 },
    short: 'Cordless, HEPA filter, 12V charge.',
    description: '<p>Cordless with a washable HEPA filter, and it charges from the car rather than needing to come inside.</p>',
  },

  // ==========================================================================
  // The rest of the catalogue — appended, never interleaved.
  //
  // A SKU is `SM-<position in this array>`, so filing these into the department
  // blocks above would renumber everything after the insertion point: `COLLECTIONS`
  // and `FLASH_SALE` name SKUs, and on a re-run every moved product would be a
  // new SKU beside its own old row rather than the same one. So the second half
  // of the shop is grouped by department here rather than merged into the first.
  //
  // Between them the two halves put at least two products in **every** child
  // category. Twenty of the forty-five aisles held nothing before this, and an
  // empty aisle is worse than a missing one: the mega menu offers it, the sidebar
  // flies out to it, and the category page renders "no products" — a shop that
  // looks broken at exactly the moment somebody is exploring it.
  // ==========================================================================

  // ---- electronics ---------------------------------------------------------
  {
    name: 'Apple iPhone 15',
    category: 'smartphones', brand: 'apple', price: '799.00', cost: '580.00',
    stock: 34, keyword: 'smartphone', newArrival: true, sold: 148,
    reviews: { count: 52, average: 4.5 },
    attributes: ['Colour:Blue', 'Material:Aluminium'],
    bundle: ['Apple AirPods Max'],
    variants: [
      { options: ['Storage:128GB'], price: '799.00', stock: 34 },
      { suffix: '256', options: ['Storage:256GB'], price: '899.00', stock: 19 },
      { suffix: '512', options: ['Storage:512GB'], price: '1099.00', stock: 6 },
    ],
    short: '6.1" Super Retina XDR, 48MP main camera, USB-C.',
    description:
      '<p>The Dynamic Island, a 48MP main camera that crops to a 2x telephoto, and USB-C on an iPhone at last.</p><ul><li>6.1" Super Retina XDR</li><li>48MP main + 12MP ultrawide</li><li>A16 Bionic</li><li>USB-C, up to 20 hours video</li></ul>',
  },
  {
    name: 'Samsung Galaxy A54 5G',
    category: 'smartphones', brand: 'samsung', price: '449.00', salePrice: '399.00', cost: '310.00',
    stock: 58, keyword: 'smartphone', sold: 203,
    reviews: { count: 71, average: 4 },
    attributes: ['Colour:Black'],
    short: '6.4" 120Hz AMOLED, 5000mAh, 5G.',
    description: '<p>A 120Hz AMOLED and a 5000mAh battery at the price most phones give you one or the other.</p>',
  },
  {
    name: 'Budget Smartphone 6.5" 128GB',
    category: 'smartphones', price: '179.00', cost: '96.00',
    stock: 120, keyword: 'mobile phone', sold: 268,
    reviews: { count: 44, average: 3.6 },
    short: '6.5" display, 128GB, dual SIM.',
    description: '<p>Dual SIM, 128GB of storage and a battery that gets through two days — the phone you buy for somebody who keeps losing theirs.</p>',
  },
  {
    name: 'Rugged Outdoor Smartphone',
    category: 'smartphones', price: '299.00', cost: '168.00',
    stock: 22, keyword: 'rugged phone', sold: 41,
    reviews: { count: 18, average: 4 },
    attributes: ['Colour:Green', 'Material:Plastic'],
    short: 'IP68, drop tested to 1.5m, 8000mAh.',
    description: '<p>IP68, drop tested to a metre and a half onto concrete, and an 8000mAh battery that will charge other things.</p>',
  },
  {
    name: 'Apple MacBook Pro 14" M3',
    category: 'laptops', brand: 'apple', price: '1999.00', cost: '1520.00',
    stock: 9, keyword: 'macbook laptop', featured: true, sold: 87,
    reviews: { count: 39, average: 4.8 },
    attributes: ['Colour:Silver', 'Material:Aluminium'],
    specs: [
      'Display|Screen size|14.2 inches',
      'Display|Type|Liquid Retina XDR, 120Hz',
      'Performance|Chip|Apple M3',
      'Memory|Unified memory|16GB',
      'Storage|SSD|512GB',
      'Battery|Life|Up to 22 hours',
      'General|Warranty|1 year limited',
    ],
    short: '14.2" Liquid Retina XDR, M3, 22-hour battery.',
    description: '<p>Twenty-two hours on a charge and a display that holds 1600 nits of peak brightness — the two things that decide whether a laptop leaves the desk.</p>',
  },
  {
    name: 'Samsung Galaxy Book3',
    category: 'laptops', brand: 'samsung', price: '899.00', salePrice: '799.00', cost: '640.00',
    stock: 17, keyword: 'laptop', sold: 62,
    reviews: { count: 26, average: 4 },
    attributes: ['Colour:Silver', 'Material:Aluminium'],
    short: '15.6" FHD, Core i5, 1.5kg.',
    description: '<p>A 15.6-inch screen in something that still weighs a kilo and a half, with a full-size keyboard and a number pad.</p>',
  },
  {
    name: 'Ultrabook 14" Core i5 512GB',
    category: 'laptops', price: '749.00', cost: '520.00',
    stock: 31, keyword: 'ultrabook laptop', sold: 95,
    reviews: { count: 33, average: 4 },
    short: '14" IPS, 16GB RAM, 512GB SSD.',
    description: '<p>Sixteen gigabytes and a 512GB SSD as standard, which is the configuration most people end up paying to upgrade to anyway.</p>',
  },
  {
    name: 'Gaming Laptop RTX 4060 16GB',
    category: 'laptops', price: '1299.00', salePrice: '1149.00', cost: '940.00',
    stock: 12, keyword: 'gaming laptop', featured: true, sold: 58,
    reviews: { count: 47, average: 4.5 },
    attributes: ['Colour:Black'],
    bundle: ['Bluetooth Soundbar 2.1 with Subwoofer'],
    short: 'RTX 4060, 165Hz QHD, 16GB DDR5.',
    description: '<p>An RTX 4060 behind a 165Hz QHD panel, and a cooling system loud enough that you will want the headphones.</p>',
  },
  {
    name: 'Sony Alpha A6400 Mirrorless',
    category: 'cameras', brand: 'sony', price: '899.00', cost: '660.00',
    stock: 14, keyword: 'mirrorless camera', sold: 73,
    reviews: { count: 35, average: 4.5 },
    attributes: ['Colour:Black'],
    short: '24.2MP APS-C, real-time eye AF, 4K.',
    description: '<p>Real-time eye autofocus that holds a moving subject, 24.2 megapixels of APS-C behind it, and 4K with no crop.</p>',
  },
  {
    name: 'Action Camera 5K Waterproof',
    category: 'cameras', price: '199.00', salePrice: '159.00', cost: '108.00',
    stock: 46, keyword: 'action camera', newArrival: true, sold: 121,
    reviews: { count: 58, average: 4 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    short: '5K30, waterproof to 10m, two batteries.',
    description: '<p>Waterproof to ten metres without a case, 5K at thirty frames, and two batteries in the box because one is never enough.</p>',
  },
  {
    name: 'Canon EF 50mm f/1.8 Lens',
    category: 'cameras', brand: 'canon', price: '129.00', cost: '84.00',
    stock: 27, keyword: 'camera lens', sold: 66,
    reviews: { count: 29, average: 4.8 },
    short: 'The fifty. Fast, sharp, cheap.',
    description: '<p>The lens everybody buys second and wishes they had bought first: f/1.8, sharp by f/2.8, and lighter than the cap on some zooms.</p>',
  },
  {
    name: 'Sony SRS-XB13 Bluetooth Speaker',
    category: 'audio', brand: 'sony', price: '59.00', salePrice: '45.00', cost: '31.00',
    stock: 88, keyword: 'bluetooth speaker', sold: 187,
    reviews: { count: 62, average: 4.5 },
    attributes: ['Colour:Blue'],
    short: 'IP67, 16 hours, fits in a hand.',
    description: '<p>Sixteen hours from something that fits in one hand, and an IP67 rating that means the beach is not a risk.</p>',
  },
  {
    name: 'Apple AirPods Max',
    category: 'audio', brand: 'apple', price: '549.00', cost: '420.00',
    stock: 8, keyword: 'over ear headphones', sold: 44,
    reviews: { count: 21, average: 4 },
    attributes: ['Colour:Silver', 'Material:Aluminium'],
    short: 'Over-ear, active noise cancellation, spatial audio.',
    description: '<p>Machined aluminium cups and a mesh canopy that spreads the weight — which matters, because these are heavy.</p>',
  },
  {
    name: 'Bluetooth Soundbar 2.1 with Subwoofer',
    category: 'audio', price: '199.00', salePrice: '149.00', cost: '105.00',
    stock: 33, keyword: 'soundbar', sold: 92,
    reviews: { count: 37, average: 4 },
    attributes: ['Colour:Black'],
    short: '2.1 channel, wireless sub, HDMI ARC.',
    description: '<p>A wireless subwoofer you can put behind the sofa, and HDMI ARC so the TV remote still controls the volume.</p>',
  },
  {
    name: 'Wireless Earbuds Sport IPX7',
    category: 'audio', price: '39.00', cost: '14.00',
    stock: 164, keyword: 'wireless earbuds', sold: 312,
    reviews: { count: 96, average: 4 },
    attributes: ['Colour:White'],
    short: 'IPX7, 30 hours with the case.',
    description: '<p>Thirty hours of playback counting the case, and an IPX7 rating that survives being run in.</p>',
  },
  {
    name: 'Samsung 65" QLED 4K TV',
    category: 'tv', brand: 'samsung', price: '1299.00', salePrice: '1099.00', cost: '920.00',
    stock: 7, keyword: 'qled television', featured: true, sold: 51,
    reviews: { count: 28, average: 4.5 },
    specs: [
      'Display|Screen size|65 inches',
      'Display|Panel|QLED, 4K UHD',
      'Display|Refresh rate|120Hz',
      'Sound|Output|60W, 2.1 channel',
      'Connectivity|HDMI|4 ports (2 x HDMI 2.1)',
      'General|Warranty|2 years',
    ],
    short: '65" QLED, 120Hz, four HDMI.',
    description: '<p>Sixty-five inches of QLED at 120Hz, with two HDMI 2.1 ports — the detail that decides whether a console runs at its best.</p>',
  },
  {
    name: 'Philips 43" Full HD Smart TV',
    category: 'tv', brand: 'philips', price: '329.00', cost: '224.00',
    stock: 21, keyword: 'smart tv', sold: 79,
    reviews: { count: 31, average: 4 },
    short: '43" Full HD, apps built in.',
    description: '<p>Forty-three inches of Full HD with the apps already on it, which is the whole job for a bedroom or a kitchen.</p>',
  },
  {
    name: '4K Streaming Media Stick',
    category: 'tv', price: '49.00', cost: '22.00',
    stock: 143, keyword: 'streaming stick', sold: 246,
    reviews: { count: 74, average: 4 },
    short: '4K HDR, voice remote, HDMI.',
    description: '<p>Plugs into the HDMI port and makes an old television behave like a new one, which is cheaper than replacing it.</p>',
  },
  {
    name: 'Canon SELPHY Photo Printer',
    category: 'printers', brand: 'canon', price: '139.00', cost: '92.00',
    stock: 24, keyword: 'photo printer', sold: 38,
    reviews: { count: 16, average: 4 },
    short: 'Dye-sub 6x4 prints, Wi-Fi, battery option.',
    description: '<p>Dye-sublimation six-by-fours in under a minute, over Wi-Fi from a phone, and it will run off a battery at a party.</p>',
  },
  {
    name: 'All-in-One Laser Printer Mono',
    category: 'printers', price: '189.00', salePrice: '159.00', cost: '122.00',
    stock: 19, keyword: 'laser printer', sold: 47,
    reviews: { count: 22, average: 3.7 },
    short: 'Print, scan, copy. 30ppm, duplex.',
    description: '<p>Thirty pages a minute, duplex both ways, and a toner cartridge that lasts long enough to forget where you put the spare.</p>',
  },

  // ---- fashion -------------------------------------------------------------
  {
    name: "Men's Slim Fit Chinos",
    category: 'mens', price: '45.00', cost: '18.00',
    stock: 96, keyword: 'chinos trousers', sold: 134,
    reviews: { count: 41, average: 4 },
    attributes: ['Colour:Blue', 'Material:Cotton'],
    variants: [
      { options: ['Size:S'], stock: 22 },
      { suffix: 'M', options: ['Size:M'], stock: 34 },
      { suffix: 'L', options: ['Size:L'], stock: 28 },
      { suffix: 'XL', options: ['Size:XL'], stock: 12 },
    ],
    short: 'Stretch cotton twill, slim through the leg.',
    description: '<p>Cotton twill with just enough stretch to sit down in, cut slim from the knee rather than the thigh.</p>',
  },
  {
    name: 'Adidas Track Jacket',
    category: 'mens', brand: 'adidas', price: '69.00', salePrice: '55.00', cost: '30.00',
    stock: 62, keyword: 'track jacket', sold: 118,
    reviews: { count: 36, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Cotton'],
    variants: [
      { options: ['Size:S'], stock: 14 },
      { suffix: 'M', options: ['Size:M'], stock: 21 },
      { suffix: 'L', options: ['Size:L'], stock: 19 },
      { suffix: 'XL', options: ['Size:XL'], stock: 8 },
    ],
    short: 'Three stripes, full zip, ribbed cuffs.',
    description: '<p>The one that has been in the catalogue since 1967, with the stripes down the sleeve and a collar that stands up.</p>',
  },
  {
    name: "Men's Oxford Shirt (Long Sleeve)",
    category: 'mens', price: '39.00', cost: '15.00',
    stock: 78, keyword: 'oxford shirt', sold: 87,
    reviews: { count: 27, average: 4 },
    attributes: ['Colour:White', 'Material:Cotton'],
    variants: [
      { options: ['Size:S'], stock: 16 },
      { suffix: 'M', options: ['Size:M'], stock: 26 },
      { suffix: 'L', options: ['Size:L'], stock: 24 },
      { suffix: 'XL', options: ['Size:XL'], stock: 12 },
    ],
    short: 'Button-down collar, 100% cotton oxford.',
    description: '<p>Proper oxford cloth with a button-down collar, which is the shirt that works with a tie and without one.</p>',
  },
  {
    name: "Women's Summer Midi Dress",
    category: 'womens', price: '55.00', cost: '21.00',
    stock: 54, keyword: 'summer dress', newArrival: true, sold: 76,
    reviews: { count: 24, average: 4.5 },
    attributes: ['Colour:Blue', 'Material:Cotton'],
    variants: [
      { options: ['Size:S'], stock: 14 },
      { suffix: 'M', options: ['Size:M'], stock: 18 },
      { suffix: 'L', options: ['Size:L'], stock: 15 },
      { suffix: 'XL', options: ['Size:XL'], stock: 7 },
    ],
    short: 'Lined viscose, side pockets, midi length.',
    description: '<p>Fully lined so it holds its shape, and it has pockets — which is the first thing anybody checks.</p>',
  },
  {
    name: "Women's Denim Jacket",
    category: 'womens', price: '69.00', salePrice: '49.00', cost: '27.00',
    stock: 47, keyword: 'denim jacket', sold: 93,
    reviews: { count: 32, average: 4 },
    attributes: ['Colour:Blue', 'Material:Cotton'],
    short: 'Mid-wash rigid denim, cropped.',
    description: '<p>Rigid denim in a mid wash, cropped to sit at the waist, and it will fade where you wear it rather than where the factory decided.</p>',
  },
  {
    name: "Women's Knit Cardigan",
    category: 'womens', price: '42.00', cost: '17.00',
    stock: 68, keyword: 'knit cardigan', sold: 58,
    reviews: { count: 19, average: 4 },
    attributes: ['Colour:Green', 'Material:Cotton'],
    short: 'Chunky knit, drop shoulder, no itch.',
    description: '<p>A chunky knit with a drop shoulder, in a cotton blend that does not itch through a t-shirt.</p>',
  },
  {
    name: "Women's High-Waist Yoga Leggings",
    category: 'womens', price: '32.00', cost: '11.00',
    stock: 132, keyword: 'yoga leggings', sold: 214,
    reviews: { count: 83, average: 4.5 },
    attributes: ['Colour:Black'],
    bundle: ['Yoga Block & Strap Set', 'Buckwheat Meditation Cushion'],
    variants: [
      { options: ['Size:S'], stock: 34 },
      { suffix: 'M', options: ['Size:M'], stock: 46 },
      { suffix: 'L', options: ['Size:L'], stock: 38 },
      { suffix: 'XL', options: ['Size:XL'], stock: 14 },
    ],
    short: 'Squat-proof, high waist, side pocket.',
    description: '<p>Four-way stretch that stays opaque when you fold over, a waistband that does not roll, and a pocket that takes a phone.</p>',
  },
  {
    name: 'Puma Suede Classic',
    category: 'shoes', brand: 'puma', price: '79.00', cost: '38.00',
    stock: 71, keyword: 'suede sneakers', sold: 165,
    reviews: { count: 54, average: 4.5 },
    attributes: ['Colour:Red', 'Material:Leather'],
    short: 'The 1968 original, still suede.',
    description: '<p>Unchanged since 1968 apart from the sock liner: suede upper, gum rubber sole, formstrip down the side.</p>',
  },
  {
    name: "Women's Lightweight Running Shoes",
    category: 'shoes', price: '89.00', salePrice: '69.00', cost: '41.00',
    stock: 58, keyword: 'running shoes', sold: 127,
    reviews: { count: 45, average: 4 },
    attributes: ['Colour:White'],
    short: '212g, breathable knit, neutral.',
    description: '<p>Two hundred and twelve grams in a size five, with a knit upper that lets the heat out on a long one.</p>',
  },
  {
    name: 'Leather Chelsea Boots',
    category: 'shoes', price: '119.00', cost: '62.00',
    stock: 29, keyword: 'chelsea boots', sold: 64,
    reviews: { count: 23, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Leather'],
    short: 'Full grain leather, elastic gusset, Goodyear welt.',
    description: '<p>Full grain leather over a Goodyear welt, which is the construction that means a cobbler can resole them rather than shrug.</p>',
  },
  {
    name: 'Smartwatch Fitness Tracker AMOLED',
    category: 'watches', price: '129.00', salePrice: '99.00', cost: '58.00',
    stock: 84, keyword: 'smartwatch', featured: true, sold: 231,
    reviews: { count: 88, average: 4 },
    attributes: ['Colour:Black', 'Material:Aluminium'],
    specs: [
      'Display|Type|1.43" AMOLED',
      'Sensors|Heart rate|24/7 optical',
      'Sensors|Blood oxygen|SpO2',
      'Battery|Typical use|Up to 14 days',
      'Water resistance|Rating|5ATM',
      'General|Warranty|1 year',
    ],
    short: '1.43" AMOLED, SpO2, 14-day battery.',
    description: '<p>Fourteen days between charges, which is the difference between a watch you wear and one that lives in a drawer.</p>',
  },
  {
    name: "Women's Rose Gold Bracelet Watch",
    category: 'watches', price: '149.00', cost: '74.00',
    stock: 26, keyword: 'womens watch', sold: 49,
    reviews: { count: 17, average: 4.5 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    short: 'Stainless bracelet, sapphire crystal, 30m.',
    description: '<p>A sapphire crystal, so it stays unscratched, on a bracelet that adjusts without a jeweller.</p>',
  },
  {
    name: 'Leather Tote Handbag',
    category: 'bags', price: '129.00', cost: '64.00',
    stock: 37, keyword: 'leather handbag', sold: 71,
    reviews: { count: 26, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Leather'],
    short: 'Full grain, laptop sleeve, magnetic close.',
    description: '<p>Full grain leather with an internal sleeve that takes a 14-inch laptop, so it is a work bag without announcing it.</p>',
  },
  {
    name: 'Canvas Crossbody Bag',
    category: 'bags', price: '49.00', salePrice: '35.00', cost: '19.00',
    stock: 92, keyword: 'crossbody bag', sold: 143,
    reviews: { count: 49, average: 4 },
    attributes: ['Colour:Green', 'Material:Cotton'],
    short: 'Waxed canvas, adjustable strap, three pockets.',
    description: '<p>Waxed canvas that darkens where it creases, and a strap long enough to wear across rather than off one shoulder.</p>',
  },

  // ---- home & kitchen ------------------------------------------------------
  {
    name: 'Philips Blender ProMix 700W',
    category: 'kitchen-appliances', brand: 'philips', price: '79.00', cost: '43.00',
    stock: 44, keyword: 'blender', sold: 108,
    reviews: { count: 34, average: 4 },
    attributes: ['Colour:White', 'Material:Plastic'],
    short: '700W, 2L jug, ice crush.',
    description: '<p>Seven hundred watts through a ribbed jug that keeps the mixture moving, so it does not stall halfway up a smoothie.</p>',
  },
  {
    name: 'Electric Kettle 1.7L Stainless',
    category: 'kitchen-appliances', price: '39.00', cost: '16.00',
    stock: 118, keyword: 'electric kettle', sold: 267,
    reviews: { count: 79, average: 4.5 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    short: '1.7L, 3000W, boil-dry cut-off.',
    description: '<p>Three kilowatts, so a mug is ready in under a minute, and a boil-dry cut-off for the time somebody forgets the water.</p>',
  },
  {
    name: 'Microwave Oven 25L Digital',
    category: 'kitchen-appliances', price: '149.00', salePrice: '119.00', cost: '88.00',
    stock: 23, keyword: 'microwave oven', sold: 62,
    reviews: { count: 25, average: 4 },
    attributes: ['Colour:Black'],
    short: '25L, 900W, grill, 10 power levels.',
    description: '<p>Twenty-five litres takes a dinner plate without catching, and the grill element means it browns rather than only heats.</p>',
  },
  {
    name: 'Cast Iron Skillet 26cm',
    category: 'cookware', price: '49.00', cost: '21.00',
    stock: 76, keyword: 'cast iron skillet', sold: 139,
    reviews: { count: 52, average: 4.8 },
    attributes: ['Colour:Black'],
    bundle: ["Chef's Knife Set with Block"],
    short: 'Pre-seasoned, oven safe, outlives you.',
    description: '<p>Pre-seasoned and oven safe to any temperature the oven reaches. Wash it with water, dry it on the hob, and it will outlast the cooker.</p>',
  },
  {
    name: 'Ceramic Dinner Set (16-piece)',
    category: 'cookware', price: '89.00', cost: '42.00',
    stock: 38, keyword: 'dinner plates', sold: 84,
    reviews: { count: 29, average: 4 },
    attributes: ['Colour:White'],
    short: 'Service for four. Dishwasher and microwave safe.',
    description: '<p>Four each of dinner plate, side plate, bowl and mug — stoneware, so the dishwasher and the microwave are both fine.</p>',
  },
  {
    name: "Chef's Knife Set with Block",
    category: 'cookware', price: '119.00', salePrice: '89.00', cost: '55.00',
    stock: 31, keyword: 'knife set', sold: 97,
    reviews: { count: 41, average: 4.5 },
    attributes: ['Material:Stainless Steel'],
    short: 'Five knives, full tang, acacia block.',
    description: '<p>Five full-tang knives in an acacia block, including the two you actually use: an eight-inch chef and a paring knife.</p>',
  },
  {
    name: 'Cotton Duvet Cover Set (King)',
    category: 'bedding', price: '79.00', cost: '33.00',
    stock: 64, keyword: 'duvet cover', sold: 112,
    reviews: { count: 38, average: 4 },
    attributes: ['Colour:White', 'Material:Cotton'],
    short: '200 thread count, king, two pillowcases.',
    description: '<p>Two hundred thread count percale, which sleeps cooler than sateen, with two pillowcases and hidden buttons.</p>',
  },
  {
    name: 'Weighted Blanket 7kg',
    category: 'bedding', price: '99.00', salePrice: '79.00', cost: '44.00',
    stock: 41, keyword: 'weighted blanket', sold: 88,
    reviews: { count: 43, average: 4.5 },
    attributes: ['Colour:Silver', 'Material:Cotton'],
    short: '7kg, glass beads, removable cover.',
    description: '<p>Seven kilos of glass beads in stitched pockets so the weight stays spread, under a cover that comes off for washing.</p>',
  },
  {
    name: 'Mattress Topper Memory Foam',
    category: 'bedding', price: '129.00', cost: '61.00',
    stock: 27, keyword: 'mattress topper', sold: 55,
    reviews: { count: 21, average: 4 },
    attributes: ['Colour:White'],
    short: '5cm gel-infused foam, double.',
    description: '<p>Five centimetres of gel-infused foam on straps that hold it to the corners, which is what stops a topper migrating overnight.</p>',
  },
  {
    name: 'Scented Candle Trio Gift Set',
    category: 'decor', price: '29.00', cost: '11.00',
    stock: 148, keyword: 'scented candles', sold: 226,
    reviews: { count: 67, average: 4.5 },
    short: 'Soy wax, three scents, 25 hours each.',
    description: '<p>Soy wax in three scents that do not fight each other, twenty-five hours a jar, boxed well enough to give as it comes.</p>',
  },
  {
    name: 'Minimalist Wall Clock 30cm',
    category: 'decor', price: '35.00', cost: '13.00',
    stock: 82, keyword: 'wall clock', sold: 74,
    reviews: { count: 24, average: 4 },
    attributes: ['Colour:White'],
    short: '30cm, silent sweep movement.',
    description: '<p>A silent sweep movement rather than a ticking one, which is the difference between a clock in a bedroom and a clock in a hallway.</p>',
  },
  {
    name: 'Arc Floor Lamp Brass',
    category: 'decor', price: '149.00', salePrice: '119.00', cost: '71.00',
    stock: 18, keyword: 'floor lamp', newArrival: true, sold: 36,
    reviews: { count: 15, average: 4 },
    attributes: ['Material:Aluminium'],
    short: '1.8m arc, marble base, dimmable.',
    description: '<p>An arc long enough to reach over a sofa, on a marble base heavy enough that it stays where you put it.</p>',
  },

  // ---- beauty --------------------------------------------------------------
  {
    name: 'Retinol Night Cream 50ml',
    category: 'skincare', price: '32.00', cost: '9.00',
    stock: 156, keyword: 'face cream', sold: 289,
    reviews: { count: 94, average: 4.5 },
    short: '0.3% retinol, 50ml, fragrance free.',
    description: '<p>Encapsulated retinol at 0.3%, which is enough to work and low enough to start on, with no fragrance to complicate it.</p>',
  },
  {
    name: 'Hyaluronic Acid Moisturiser',
    category: 'skincare', price: '26.00', cost: '8.00',
    stock: 173, keyword: 'moisturiser', sold: 241,
    reviews: { count: 77, average: 4 },
    short: 'Lightweight gel-cream, all skin types.',
    description: '<p>A gel-cream that sinks in rather than sitting on top, so it works under sunscreen in the morning.</p>',
  },
  {
    name: 'Sunscreen SPF 50+ 100ml',
    category: 'skincare', price: '19.00', cost: '6.00',
    stock: 204, keyword: 'sunscreen', sold: 318,
    reviews: { count: 102, average: 4.5 },
    short: 'SPF 50+, broad spectrum, no white cast.',
    description: '<p>Broad spectrum SPF 50+ that finishes clear on every skin tone — the reason people actually reapply it.</p>',
  },
  {
    name: 'Hair Straightener Ceramic Pro',
    category: 'haircare', price: '69.00', salePrice: '49.00', cost: '28.00',
    stock: 59, keyword: 'hair straightener', sold: 147,
    reviews: { count: 56, average: 4 },
    attributes: ['Colour:Black'],
    short: 'Ceramic plates, 150–230°C, 15s heat-up.',
    description: '<p>Floating ceramic plates and a temperature dial rather than one setting, because 230°C on fine hair is how it breaks.</p>',
  },
  {
    name: 'Argan Oil Shampoo & Conditioner Set',
    category: 'haircare', price: '29.00', cost: '10.00',
    stock: 136, keyword: 'shampoo bottles', sold: 198,
    reviews: { count: 61, average: 4 },
    short: 'Sulphate free, 400ml each.',
    description: '<p>Sulphate free, so it will not strip colour, in bottles big enough to last a couple of months.</p>',
  },
  {
    name: 'Beard Trimmer Kit Rechargeable',
    category: 'grooming', price: '45.00', cost: '19.00',
    stock: 87, keyword: 'beard trimmer', sold: 163,
    reviews: { count: 58, average: 4 },
    attributes: ['Colour:Black'],
    short: '20 lengths, 90 minutes cordless, washable.',
    description: '<p>Twenty guide lengths on a dial rather than a box of combs, ninety minutes off a charge, and the head rinses under a tap.</p>',
  },
  {
    name: 'Philips Sonicare Electric Toothbrush',
    category: 'grooming', brand: 'philips', price: '89.00', salePrice: '69.00', cost: '46.00',
    stock: 49, keyword: 'electric toothbrush', sold: 174,
    reviews: { count: 72, average: 4.5 },
    attributes: ['Colour:White'],
    short: 'Sonic, pressure sensor, two weeks per charge.',
    description: '<p>A pressure sensor that stops you scrubbing, a two-minute timer that quadrants itself, and a fortnight between charges.</p>',
  },
  {
    name: 'Eau de Parfum Noir 100ml',
    category: 'fragrance', price: '89.00', cost: '31.00',
    stock: 42, keyword: 'perfume bottle', sold: 81,
    reviews: { count: 30, average: 4.5 },
    short: 'Bergamot, leather, vetiver. 8 hours.',
    description: '<p>Opens on bergamot and dries down to leather and vetiver, and it is still there eight hours later.</p>',
  },
  {
    name: 'Floral Eau de Toilette 50ml',
    category: 'fragrance', price: '65.00', cost: '24.00',
    stock: 53, keyword: 'perfume', sold: 69,
    reviews: { count: 22, average: 4 },
    short: 'Peony, pear, white musk.',
    description: '<p>Peony and pear over a white musk base — light enough for an office, which is the hardest thing for a floral to be.</p>',
  },
  {
    name: 'Fragrance Discovery Set (5 x 10ml)',
    category: 'fragrance', price: '49.00', salePrice: '39.00', cost: '18.00',
    stock: 71, keyword: 'perfume samples', newArrival: true, sold: 94,
    reviews: { count: 33, average: 4 },
    short: 'Five 10ml sprays, refillable atomiser.',
    description: '<p>Five ten-millilitre sprays, which is enough of each to know whether it works on you rather than on the card.</p>',
  },

  // ---- sports & outdoors ---------------------------------------------------
  {
    name: 'Adjustable Dumbbell Set 24kg',
    category: 'fitness', price: '199.00', salePrice: '159.00', cost: '96.00',
    stock: 24, keyword: 'dumbbells', sold: 118,
    reviews: { count: 47, average: 4.5 },
    attributes: ['Material:Stainless Steel'],
    bundle: ['Resistance Bands Set (5 levels)', 'Whey Protein Powder 1kg Vanilla'],
    short: '2 x 24kg, dial adjust, replaces 30 dumbbells.',
    description: '<p>A dial that swaps the whole rack for two handles and a cradle, which is the only version of this that fits in a flat.</p>',
  },
  {
    name: 'Resistance Bands Set (5 levels)',
    category: 'fitness', price: '25.00', cost: '7.00',
    stock: 218, keyword: 'resistance bands', sold: 342,
    reviews: { count: 108, average: 4.5 },
    short: 'Five bands, door anchor, carry bag.',
    description: '<p>Five latex bands from light to extra heavy, plus the door anchor that turns them into a cable machine.</p>',
  },
  {
    name: 'Foldable Treadmill 2.5HP',
    category: 'fitness', price: '599.00', salePrice: '499.00', cost: '340.00',
    stock: 6, keyword: 'treadmill', sold: 29,
    reviews: { count: 19, average: 4 },
    specs: [
      'Motor|Power|2.5HP continuous',
      'Speed|Range|1–16 km/h',
      'Incline|Levels|3 manual positions',
      'Deck|Running surface|130 x 45cm',
      'Storage|Folded depth|24cm',
      'General|Maximum user weight|120kg',
    ],
    short: '16 km/h, folds to 24cm, 120kg limit.',
    description: '<p>Folds to twenty-four centimetres so it goes under a bed, and still runs to sixteen kilometres an hour when it is out.</p>',
  },
  {
    name: 'Nike Gym Duffel Bag',
    category: 'backpacks', brand: 'nike', price: '45.00', cost: '20.00',
    stock: 93, keyword: 'duffel bag', sold: 156,
    reviews: { count: 51, average: 4.5 },
    attributes: ['Colour:Black'],
    short: '40L, vented shoe compartment, wet pocket.',
    description: '<p>Forty litres with a vented end pocket for the shoes and a lined one for whatever is still wet.</p>',
  },
  {
    name: 'Hiking Backpack 45L',
    category: 'backpacks', price: '89.00', cost: '40.00',
    stock: 47, keyword: 'hiking backpack', sold: 83,
    reviews: { count: 31, average: 4.5 },
    attributes: ['Colour:Green'],
    short: '45L, adjustable harness, rain cover.',
    description: '<p>Forty-five litres over an adjustable back length, so the weight lands on the hips rather than the shoulders, with the rain cover in its own pocket.</p>',
  },
  {
    name: 'Insulated Travel Mug 500ml',
    category: 'hydration', price: '24.00', cost: '8.00',
    stock: 187, keyword: 'travel mug', sold: 271,
    reviews: { count: 86, average: 4 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    short: 'Six hours hot, leakproof, one-handed lid.',
    description: '<p>Six hours hot, genuinely leakproof in a bag, and the lid opens with the hand that is holding it.</p>',
  },
  {
    name: 'Collapsible Water Bottle 750ml',
    category: 'hydration', price: '15.00', cost: '5.00',
    stock: 231, keyword: 'water bottle', sold: 189,
    reviews: { count: 57, average: 3.6 },
    attributes: ['Colour:Blue', 'Material:Plastic'],
    short: 'Rolls flat, 750ml, carabiner clip.',
    description: '<p>Rolls down to the size of a fist when it is empty, which is the whole point of carrying one on the way out.</p>',
  },
  {
    name: '4-Person Dome Tent',
    category: 'camping', price: '149.00', salePrice: '119.00', cost: '72.00',
    stock: 21, keyword: 'camping tent', sold: 44,
    reviews: { count: 26, average: 4 },
    attributes: ['Colour:Green'],
    bundle: ['Sleeping Bag -5°C Mummy', 'Portable Camping Gas Stove'],
    short: 'Sleeps 4, 3000mm hydrostatic head, 10 minutes up.',
    description: '<p>A 3000mm flysheet and taped seams, which is the pair of numbers that decides whether a wet night is miserable.</p>',
  },
  {
    name: 'Sleeping Bag -5°C Mummy',
    category: 'camping', price: '79.00', cost: '34.00',
    stock: 38, keyword: 'sleeping bag', sold: 67,
    reviews: { count: 23, average: 4.5 },
    attributes: ['Colour:Blue'],
    short: 'Comfort to -5°C, 1.6kg, compression sack.',
    description: '<p>Comfort rated to minus five, hooded, and it packs into a compression sack rather than the bag it arrived in.</p>',
  },
  {
    name: 'Portable Camping Gas Stove',
    category: 'camping', price: '39.00', cost: '15.00',
    stock: 74, keyword: 'camping stove', sold: 91,
    reviews: { count: 28, average: 4 },
    attributes: ['Material:Stainless Steel'],
    short: 'Piezo ignition, windshield, hard case.',
    description: '<p>Piezo ignition so there are no matches to keep dry, and a windshield that means it still boils in a breeze.</p>',
  },

  // ---- toys & games --------------------------------------------------------
  {
    name: 'Wooden Train Set (80 pieces)',
    category: 'building-toys', price: '59.00', cost: '24.00',
    stock: 52, keyword: 'wooden train toy', sold: 76,
    reviews: { count: 27, average: 4.5 },
    short: '80 pieces, beech track, fits the big brands.',
    description: '<p>Beech track cut to the same gauge as the expensive sets, so it joins onto whatever is already in the toy box.</p>',
  },
  {
    name: 'Magnetic Tiles Set (100 pieces)',
    category: 'building-toys', price: '45.00', salePrice: '35.00', cost: '17.00',
    stock: 88, keyword: 'magnetic tiles', sold: 134,
    reviews: { count: 49, average: 4.5 },
    short: '100 tiles, riveted seams, ages 3+.',
    description: '<p>Riveted rather than glued, which is what stops a tile splitting and letting a magnet out.</p>',
  },
  {
    name: 'RC Quadcopter Drone with Camera',
    category: 'rc-toys', price: '129.00', salePrice: '99.00', cost: '58.00',
    stock: 34, keyword: 'drone', featured: true, sold: 112,
    reviews: { count: 54, average: 4 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    short: '1080p, 25 minutes with two batteries, altitude hold.',
    description: '<p>Altitude hold makes it flyable by somebody who has never flown one, and two batteries make the afternoon last.</p>',
  },
  {
    name: 'Remote Control Monster Truck 4WD',
    category: 'rc-toys', price: '59.00', cost: '25.00',
    stock: 61, keyword: 'monster truck toy', sold: 88,
    reviews: { count: 32, average: 4 },
    attributes: ['Colour:Red'],
    short: '4WD, 25 km/h, waterproof electronics.',
    description: '<p>Four-wheel drive and sealed electronics, so grass, gravel and puddles are all fair game.</p>',
  },
  {
    name: 'Family Strategy Board Game',
    category: 'board-games', price: '39.00', cost: '15.00',
    stock: 79, keyword: 'board game', sold: 103,
    reviews: { count: 39, average: 4.5 },
    short: '2–5 players, 45 minutes, ages 10+.',
    description: '<p>Forty-five minutes and rules that explain in five, which is the combination that gets a game played twice.</p>',
  },
  {
    name: 'Wooden Chess Set Tournament Size',
    category: 'board-games', price: '49.00', cost: '20.00',
    stock: 43, keyword: 'chess set', sold: 58,
    reviews: { count: 21, average: 4.8 },
    short: '50cm folding board, weighted pieces.',
    description: '<p>Weighted pieces on a 50cm board that folds to store them, with a king at the tournament 95mm.</p>',
  },
  {
    name: 'Card Game Party Pack',
    category: 'board-games', price: '19.00', cost: '6.00',
    stock: 164, keyword: 'playing cards', sold: 217,
    reviews: { count: 63, average: 4 },
    short: 'Three games, 4–10 players, one tin.',
    description: '<p>Three games in one tin, all of them playable by ten people who have had a drink.</p>',
  },

  // ---- tools & home improvement --------------------------------------------
  {
    name: 'Angle Grinder 900W',
    category: 'power-tools', price: '79.00', cost: '38.00',
    stock: 36, keyword: 'angle grinder', sold: 64,
    reviews: { count: 24, average: 4 },
    attributes: ['Material:Aluminium'],
    short: '900W, 115mm, restart protection.',
    description: '<p>Nine hundred watts through a 115mm disc, with restart protection so it does not leap when the power comes back.</p>',
  },
  {
    name: 'Random Orbital Sander 300W',
    category: 'power-tools', price: '65.00', salePrice: '49.00', cost: '29.00',
    stock: 42, keyword: 'sander tool', sold: 51,
    reviews: { count: 18, average: 4 },
    short: '300W, 125mm, dust extraction.',
    description: '<p>Dust extraction that actually connects to a vacuum, which is the difference between sanding indoors and not.</p>',
  },
  {
    name: 'Socket Wrench Set (46-piece)',
    category: 'hand-tools', price: '55.00', cost: '23.00',
    stock: 68, keyword: 'socket set', sold: 97,
    reviews: { count: 35, average: 4.5 },
    attributes: ['Material:Stainless Steel'],
    short: '46 pieces, metric and imperial, 72-tooth ratchet.',
    description: '<p>A 72-tooth ratchet needs five degrees of swing, which is what gets a bolt out of a space your hand barely fits into.</p>',
  },
  {
    name: 'Laser Distance Measure 40m',
    category: 'hand-tools', price: '45.00', cost: '19.00',
    stock: 57, keyword: 'laser measure', newArrival: true, sold: 43,
    reviews: { count: 16, average: 4 },
    short: '40m, ±2mm, area and volume.',
    description: '<p>Forty metres to within two millimetres, and it does the area and volume arithmetic so nobody has to.</p>',
  },
  {
    name: 'Rolling Tool Chest 5-Drawer',
    category: 'tool-storage', price: '249.00', salePrice: '199.00', cost: '128.00',
    stock: 11, keyword: 'tool chest', sold: 27,
    reviews: { count: 14, average: 4.5 },
    attributes: ['Colour:Red', 'Material:Stainless Steel'],
    bundle: ['Socket Wrench Set (46-piece)', 'Heavy Duty Tool Bag 18"'],
    short: '5 drawers, ball-bearing runners, lockable.',
    description: '<p>Ball-bearing runners that still slide with a full drawer, on castors that lock, and one key for the lot.</p>',
  },
  {
    name: 'Heavy Duty Tool Bag 18"',
    category: 'tool-storage', price: '45.00', cost: '18.00',
    stock: 73, keyword: 'tool bag', sold: 69,
    reviews: { count: 22, average: 4 },
    attributes: ['Colour:Black'],
    short: '18", 24 pockets, moulded base.',
    description: '<p>A moulded base so it stands up on wet ground, and twenty-four pockets so the small things stay findable.</p>',
  },
  {
    name: 'Wall-Mounted Pegboard Kit',
    category: 'tool-storage', price: '69.00', cost: '30.00',
    stock: 39, keyword: 'pegboard tools', sold: 34,
    reviews: { count: 12, average: 4 },
    short: '120 x 60cm, 40 hooks, steel.',
    description: '<p>Steel rather than hardboard, so a hook holds a drill instead of tearing out, with forty of them in the box.</p>',
  },

  // ---- automotive ----------------------------------------------------------
  {
    name: 'Car Bluetooth FM Transmitter',
    category: 'car-electronics', price: '25.00', cost: '8.00',
    stock: 176, keyword: 'car bluetooth', sold: 248,
    reviews: { count: 71, average: 3.6 },
    short: 'Bluetooth 5.0, two USB, hands-free.',
    description: '<p>Puts Bluetooth into a car that never had it, and charges two phones while it does — reception depending on where you live.</p>',
  },
  {
    name: 'Digital Tyre Inflator 12V',
    category: 'car-electronics', price: '45.00', salePrice: '35.00', cost: '19.00',
    stock: 84, keyword: 'tyre inflator', sold: 152,
    reviews: { count: 58, average: 4 },
    short: 'Preset pressure, auto stop, light.',
    description: '<p>Set the pressure and it stops there on its own, which is the feature that makes checking the tyres a two-minute job.</p>',
  },
  {
    name: 'Car Wash Kit (12-piece)',
    category: 'car-care', price: '39.00', cost: '16.00',
    stock: 91, keyword: 'car wash', sold: 87,
    reviews: { count: 29, average: 4 },
    short: 'Grit-guard bucket, mitt, two towels, brushes.',
    description: '<p>The bucket has a grit guard in the bottom, which is the one piece that stops a wash putting swirls into the paint.</p>',
  },
  {
    name: 'Ceramic Coating Spray 500ml',
    category: 'car-care', price: '29.00', cost: '11.00',
    stock: 128, keyword: 'car polish', sold: 116,
    reviews: { count: 41, average: 4.5 },
    short: 'SiO2, six months, spray and wipe.',
    description: '<p>Spray on a wet car and wipe off — six months of beading for fifteen minutes of work.</p>',
  },
  {
    name: 'Magnetic Car Phone Mount',
    category: 'car-accessories', price: '19.00', cost: '5.00',
    stock: 243, keyword: 'phone holder car', sold: 331,
    reviews: { count: 97, average: 4 },
    attributes: ['Colour:Black'],
    short: 'Vent clip, N52 magnets, holds a case.',
    description: '<p>N52 magnets hold a phone in a thick case over a speed bump, and the vent clip does not sag like a windscreen sucker.</p>',
  },
  {
    name: 'Universal Car Seat Covers (Set of 5)',
    category: 'car-accessories', price: '79.00', salePrice: '59.00', cost: '33.00',
    stock: 46, keyword: 'car seat cover', sold: 73,
    reviews: { count: 26, average: 3.6 },
    attributes: ['Colour:Black', 'Material:Leather'],
    short: 'Five seats, airbag compatible, washable.',
    description: '<p>Airbag-compatible side seams and a washable faux leather — universal fit, which means good on most cars and perfect on none.</p>',
  },

  // ---- books & stationery --------------------------------------------------
  {
    name: 'The Silent Harbour — Paperback Novel',
    category: 'fiction', price: '14.00', cost: '5.00',
    stock: 132, keyword: 'novel book', sold: 186,
    reviews: { count: 59, average: 4.5 },
    short: 'Literary fiction. 384 pages, paperback.',
    description: '<p>Three hundred and eighty-four pages set over one winter in a fishing town that is running out of fish.</p>',
  },
  {
    name: 'Midnight Archive — Hardback Thriller',
    category: 'fiction', price: '22.00', cost: '8.00',
    stock: 87, keyword: 'thriller book', sold: 124,
    reviews: { count: 43, average: 4 },
    short: 'Thriller. 448 pages, hardback.',
    description: '<p>A first edition hardback, sewn rather than glued, which is the binding that survives being lent out.</p>',
  },
  {
    name: 'The Practical Investor — Hardback',
    category: 'non-fiction', price: '26.00', cost: '10.00',
    stock: 64, keyword: 'business book', sold: 92,
    reviews: { count: 34, average: 4 },
    short: 'Personal finance. 312 pages, hardback.',
    description: '<p>Three hundred pages on compounding, fees and doing nothing, which is most of what there is to say.</p>',
  },
  {
    name: 'Illustrated World Atlas',
    category: 'non-fiction', price: '39.00', salePrice: '29.00', cost: '15.00',
    stock: 41, keyword: 'atlas map book', sold: 57,
    reviews: { count: 19, average: 4.5 },
    short: 'Large format, 200 maps, current borders.',
    description: '<p>Large format on heavy paper, with two hundred maps drawn to the borders as they stand rather than as they were.</p>',
  },
  {
    name: 'Hardcover Dotted Notebook A5 (3-pack)',
    category: 'stationery', price: '24.00', cost: '8.00',
    stock: 198, keyword: 'notebook', sold: 274,
    reviews: { count: 81, average: 4.5 },
    short: '160gsm dotted, 192 pages, lies flat.',
    description: '<p>A hundred and sixty gsm, so a fountain pen does not come through, and a sewn spine that lets it lie flat.</p>',
  },
  {
    name: 'Fountain Pen Gift Set',
    category: 'stationery', price: '45.00', cost: '17.00',
    stock: 56, keyword: 'fountain pen', sold: 63,
    reviews: { count: 24, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Stainless Steel'],
    short: 'Medium nib, converter and cartridges, boxed.',
    description: '<p>A medium steel nib with both a converter and cartridges in the box, so it works out of the tin either way.</p>',
  },

  // ---- health & wellness ---------------------------------------------------
  {
    name: 'Multivitamin Daily Complex (120 tablets)',
    category: 'supplements', price: '25.00', cost: '7.00',
    stock: 214, keyword: 'vitamin tablets', sold: 296,
    reviews: { count: 88, average: 4 },
    short: '120 tablets, four months, 24 nutrients.',
    description: '<p>Four months in a bottle, with the twenty-four nutrients listed at their amounts rather than as a blend.</p>',
  },
  {
    name: 'Whey Protein Powder 1kg Vanilla',
    category: 'supplements', price: '45.00', salePrice: '35.00', cost: '19.00',
    stock: 137, keyword: 'protein powder', sold: 243,
    reviews: { count: 92, average: 4.5 },
    short: '24g protein per scoop, 33 servings.',
    description: '<p>Twenty-four grams a scoop and thirty-three scoops a tub, and it mixes in a shaker without a blender.</p>',
  },
  {
    name: 'Digital Blood Pressure Monitor',
    category: 'wellness-devices', price: '55.00', cost: '24.00',
    stock: 72, keyword: 'blood pressure monitor', sold: 118,
    reviews: { count: 44, average: 4.5 },
    attributes: ['Colour:White'],
    short: 'Upper arm, clinically validated, two users.',
    description: '<p>An upper-arm cuff rather than a wrist one, which is the version a GP will accept readings from, with memory for two people.</p>',
  },
  {
    name: 'Fingertip Pulse Oximeter',
    category: 'wellness-devices', price: '25.00', cost: '8.00',
    stock: 165, keyword: 'pulse oximeter', sold: 207,
    reviews: { count: 66, average: 4 },
    short: 'SpO2 and pulse, OLED, 10 seconds.',
    description: '<p>Reads oxygen saturation and pulse in about ten seconds, on an OLED that can be turned to face you.</p>',
  },
  {
    name: 'Yoga Block & Strap Set',
    category: 'yoga', price: '22.00', cost: '7.00',
    stock: 143, keyword: 'yoga block', sold: 158,
    reviews: { count: 47, average: 4.5 },
    short: 'Two cork blocks, 2.5m cotton strap.',
    description: '<p>Cork rather than foam, so a block takes weight without folding, and a strap long enough to be useful behind the back.</p>',
  },
  {
    name: 'Buckwheat Meditation Cushion',
    category: 'yoga', price: '45.00', cost: '18.00',
    stock: 48, keyword: 'meditation cushion', sold: 52,
    reviews: { count: 18, average: 4.5 },
    attributes: ['Material:Cotton'],
    short: 'Buckwheat hulls, adjustable fill, washable cover.',
    description: '<p>Buckwheat hulls hold a shape where foam collapses, and the zip means you can take some out until the height is right.</p>',
  },

  // ---- pet supplies --------------------------------------------------------
  {
    name: 'Orthopaedic Dog Bed (Large)',
    category: 'dog', price: '79.00', salePrice: '59.00', cost: '31.00',
    stock: 57, keyword: 'dog bed', sold: 104,
    reviews: { count: 38, average: 4.5 },
    bundle: ['No-Pull Dog Harness Adjustable', 'Deshedding Pet Grooming Brush'],
    short: '100 x 70cm, memory foam, washable cover.',
    description: '<p>A memory foam base for an older dog, under a cover that comes off and goes in the machine — which it will need to.</p>',
  },
  {
    name: 'No-Pull Dog Harness Adjustable',
    category: 'dog', price: '29.00', cost: '10.00',
    stock: 149, keyword: 'dog harness', sold: 221,
    reviews: { count: 74, average: 4 },
    attributes: ['Colour:Red'],
    short: 'Front and back clips, reflective, four sizes.',
    description: '<p>A front clip turns a dog that pulls rather than choking it, and the whole thing is reflective for winter evenings.</p>',
  },
  {
    name: 'Cat Tree Tower 120cm',
    category: 'cat', price: '89.00', cost: '39.00',
    stock: 33, keyword: 'cat tree', sold: 68,
    reviews: { count: 27, average: 4 },
    short: '120cm, sisal posts, two hammocks.',
    description: '<p>Sisal posts all the way up rather than only at the bottom, and a base wide enough that it does not rock.</p>',
  },
  {
    name: 'Self-Cleaning Cat Litter Tray',
    category: 'cat', price: '69.00', salePrice: '55.00', cost: '29.00',
    stock: 41, keyword: 'cat litter box', sold: 76,
    reviews: { count: 31, average: 3.6 },
    short: 'Rotating sift, no power, liner bags.',
    description: '<p>Rolls to sift rather than plugging in, which is quieter and gives a nervous cat nothing to be frightened of.</p>',
  },
  {
    name: 'Automatic Pet Water Fountain',
    category: 'pet-accessories', price: '39.00', cost: '15.00',
    stock: 96, keyword: 'pet water fountain', sold: 133,
    reviews: { count: 49, average: 4 },
    short: '2.4L, carbon filter, near-silent pump.',
    description: '<p>Moving water gets a cat drinking more, and the pump on this one is quiet enough to leave in a kitchen overnight.</p>',
  },
  {
    name: 'Deshedding Pet Grooming Brush',
    category: 'pet-accessories', price: '19.00', cost: '5.00',
    stock: 217, keyword: 'pet brush', sold: 289,
    reviews: { count: 84, average: 4.5 },
    short: 'Stainless edge, one-press release.',
    description: '<p>A stainless edge that reaches the undercoat, and a button that drops the fur straight in the bin.</p>',
  },

  // ---- garden & outdoor ----------------------------------------------------
  {
    name: 'Cordless Hedge Trimmer 20V',
    category: 'garden-tools', price: '99.00', salePrice: '79.00', cost: '46.00',
    stock: 28, keyword: 'hedge trimmer', sold: 47,
    reviews: { count: 21, average: 4 },
    bundle: ['Garden Hand Tool Set (5-piece)'],
    short: '20V, 51cm blade, 18mm cut.',
    description: '<p>A 51cm blade that takes an 18mm branch, with no cable to cut through — which is how most corded ones end.</p>',
  },
  {
    name: 'Garden Hand Tool Set (5-piece)',
    category: 'garden-tools', price: '35.00', cost: '13.00',
    stock: 104, keyword: 'garden tools', sold: 89,
    reviews: { count: 32, average: 4 },
    attributes: ['Material:Stainless Steel'],
    short: 'Trowel, fork, weeder, cultivator, pruner.',
    description: '<p>Stainless heads on ash handles, so they come out of the soil clean and do not snap at the neck.</p>',
  },
  {
    name: 'Rattan Bistro Set (2 chairs, 1 table)',
    category: 'outdoor-furniture', price: '249.00', salePrice: '199.00', cost: '121.00',
    stock: 14, keyword: 'garden furniture', featured: true, sold: 33,
    reviews: { count: 17, average: 4.5 },
    short: 'PE rattan, steel frame, glass top.',
    description: '<p>PE rattan over a powder-coated steel frame — the combination that survives a winter outside rather than needing to come in.</p>',
  },
  {
    /*
     * The second deliberate out-of-stock, and in a different department from the
     * first: the availability facet is offered per listing, so a catalogue whose
     * only sold-out product sits under Tools never draws it anywhere else.
     */
    name: 'Garden Parasol 2.7m with Base',
    category: 'outdoor-furniture', price: '89.00', cost: '38.00',
    stock: 0, keyword: 'garden parasol', sold: 41,
    reviews: { count: 15, average: 4 },
    short: '2.7m, crank and tilt, base included.',
    description: '<p>Two point seven metres on a crank, with the base in the price — which is usually where the rest of the money goes.</p>',
  },
  {
    name: 'Herb Garden Starter Kit',
    category: 'plants', price: '29.00', cost: '10.00',
    stock: 126, keyword: 'herb plants', newArrival: true, sold: 97,
    reviews: { count: 35, average: 4.5 },
    short: 'Six herbs, pots, compost discs, markers.',
    description: '<p>Six herbs that will actually grow on a windowsill, with the pots, the compost and the labels you would forget to buy.</p>',
  },
  {
    name: 'Artificial Olive Tree 120cm',
    category: 'plants', price: '79.00', cost: '32.00',
    stock: 36, keyword: 'artificial plant', sold: 54,
    reviews: { count: 19, average: 4 },
    attributes: ['Colour:Green', 'Material:Plastic'],
    short: '120cm, real wood trunk, UV stable.',
    description: '<p>A real wood trunk under UV-stable leaves, so it holds its colour in a window instead of going grey by August.</p>',
  },

  // ==========================================================================
  // A hundred more, on the same rule: appended, never interleaved.
  //
  // The block above put two products in every aisle, which is enough for a
  // category page to render but not enough to *behave* like one — with two rows
  // there is nothing to sort, nothing the price filter excludes, and the second
  // page of results never exists. These take every aisle to four or more, so the
  // listing controls have something to act on wherever a visitor lands.
  // ==========================================================================

  // ---- electronics, continued ----------------------------------------------
  {
    name: 'Samsung Galaxy Z Flip5',
    category: 'smartphones', brand: 'samsung', price: '1099.00', salePrice: '949.00', cost: '760.00',
    stock: 15, keyword: 'foldable phone', featured: true, sold: 67,
    reviews: { count: 34, average: 4 },
    attributes: ['Colour:Green'],
    short: 'Folds in half, 3.4" cover screen, 6.7" main.',
    description: '<p>Folds to something that fits a coat pocket, with a cover screen big enough to answer a message without opening it.</p>',
  },
  {
    name: 'Apple iPhone SE (3rd gen)',
    category: 'smartphones', brand: 'apple', price: '499.00', cost: '350.00',
    stock: 43, keyword: 'iphone', sold: 156,
    reviews: { count: 48, average: 4 },
    attributes: ['Colour:White', 'Material:Aluminium'],
    short: '4.7", A15 Bionic, Touch ID.',
    description: '<p>The last iPhone with a home button, running the same chip as phones costing twice as much.</p>',
  },
  {
    name: '5G Phone 8GB/256GB Dual SIM',
    category: 'smartphones', price: '329.00', salePrice: '279.00', cost: '198.00',
    stock: 76, keyword: 'android phone', sold: 194,
    reviews: { count: 63, average: 4 },
    short: '8GB RAM, 256GB, 108MP camera.',
    description: '<p>Eight gigabytes of memory and 256 of storage at a price where most phones give you half of each.</p>',
  },
  {
    name: 'Convertible 2-in-1 Touchscreen Laptop',
    category: 'laptops', price: '849.00', salePrice: '749.00', cost: '590.00',
    stock: 22, keyword: 'convertible laptop', sold: 71,
    reviews: { count: 29, average: 4 },
    attributes: ['Colour:Silver', 'Material:Aluminium'],
    short: '360° hinge, 14" touch, stylus included.',
    description: '<p>A hinge that goes all the way round and a stylus in the box, so it is a tablet when the keyboard is in the way.</p>',
  },
  {
    name: 'Chromebook 14" 64GB',
    category: 'laptops', price: '279.00', cost: '186.00',
    stock: 58, keyword: 'chromebook', sold: 213,
    reviews: { count: 67, average: 4 },
    short: '14" FHD, 12-hour battery, boots in 6 seconds.',
    description: '<p>Boots in about six seconds and lasts a school day, which between them are the whole argument for one.</p>',
  },
  {
    name: 'Business Laptop 15.6" Core i7',
    category: 'laptops', price: '1099.00', cost: '790.00',
    stock: 16, keyword: 'business laptop', sold: 48,
    reviews: { count: 23, average: 4.5 },
    attributes: ['Colour:Black'],
    short: 'Core i7, 16GB, fingerprint reader, TPM 2.0.',
    description:
      '<p>A fingerprint reader, a TPM and a keyboard rated for ten million presses — the things a laptop needs when it belongs to a job rather than a person.</p>',
  },
  {
    name: 'Camera Tripod Carbon Fibre',
    category: 'cameras', price: '159.00', salePrice: '129.00', cost: '78.00',
    stock: 34, keyword: 'camera tripod', sold: 62,
    reviews: { count: 25, average: 4.5 },
    attributes: ['Colour:Black'],
    short: '1.6m, 1.2kg, ball head, folds to 40cm.',
    description: '<p>A kilo and a bit of carbon fibre that still holds a 5kg body, and folds down short enough for hand luggage.</p>',
  },
  {
    name: 'Instant Print Camera',
    category: 'cameras', price: '89.00', cost: '52.00',
    stock: 67, keyword: 'instant camera', newArrival: true, sold: 148,
    reviews: { count: 56, average: 4 },
    attributes: ['Colour:White', 'Material:Plastic'],
    short: 'Credit-card prints in 90 seconds, selfie mirror.',
    description: '<p>A print in your hand in ninety seconds, which is a different thing from a photograph on a phone and still the reason these sell.</p>',
  },
  {
    name: 'Sony WF-C700N Noise Cancelling Earbuds',
    category: 'audio', brand: 'sony', price: '99.00', salePrice: '79.00', cost: '56.00',
    stock: 72, keyword: 'earbuds', sold: 187,
    reviews: { count: 74, average: 4.5 },
    attributes: ['Colour:Black'],
    short: 'ANC, 15 hours with case, IPX4.',
    description: '<p>Active noise cancelling in something that weighs four and a half grams a side, so they stay in on a run.</p>',
  },
  {
    name: 'Studio Monitor Headphones 50mm',
    category: 'audio', price: '129.00', cost: '68.00',
    stock: 41, keyword: 'studio headphones', sold: 84,
    reviews: { count: 33, average: 4.5 },
    attributes: ['Colour:Black'],
    short: 'Closed back, 50mm drivers, coiled cable.',
    description: '<p>Closed-back and flat rather than flattering, which is what you want when you are deciding whether a mix is right.</p>',
  },
  {
    name: 'Portable Party Speaker 120W',
    category: 'audio', price: '179.00', salePrice: '139.00', cost: '92.00',
    stock: 29, keyword: 'party speaker', sold: 96,
    reviews: { count: 41, average: 4 },
    short: '120W, 12 hours, mic input, wheels.',
    description: '<p>A hundred and twenty watts, twelve hours off the battery, and a microphone socket for whoever insists.</p>',
  },
  {
    name: 'Samsung 32" HD Smart Monitor TV',
    category: 'tv', brand: 'samsung', price: '249.00', cost: '168.00',
    stock: 37, keyword: 'small television', sold: 112,
    reviews: { count: 44, average: 4 },
    short: '32", works as a TV and a monitor.',
    description: '<p>Thirty-two inches that answers to both a remote and a laptop, which suits a desk in a spare room doing two jobs.</p>',
  },
  {
    name: 'TV Wall Mount Full Motion 32–70"',
    category: 'tv', price: '59.00', salePrice: '45.00', cost: '24.00',
    stock: 118, keyword: 'tv wall bracket', sold: 234,
    reviews: { count: 78, average: 4.5 },
    attributes: ['Material:Stainless Steel'],
    short: 'Tilts, swivels, extends 40cm. 45kg rated.',
    description: '<p>Extends forty centimetres off the wall and swivels, so a television in a corner can face the sofa rather than the room.</p>',
  },
  {
    name: 'Inkjet All-in-One Wireless Printer',
    category: 'printers', price: '99.00', salePrice: '79.00', cost: '58.00',
    stock: 54, keyword: 'inkjet printer', sold: 143,
    reviews: { count: 52, average: 3.7 },
    short: 'Print, scan, copy. Wi-Fi, AirPrint.',
    description: '<p>Prints from a phone without installing anything, which is nearly always what a printer at home is asked to do.</p>',
  },
  {
    name: 'Portable Document Scanner A4',
    category: 'printers', price: '149.00', cost: '96.00',
    stock: 26, keyword: 'document scanner', sold: 39,
    reviews: { count: 15, average: 4 },
    short: 'A4, 15 pages a minute, USB powered.',
    description: '<p>Runs off the USB cable with no power brick, and turns a drawer of paperwork into a folder in an afternoon.</p>',
  },

  // ---- fashion, continued --------------------------------------------------
  {
    name: "Men's Wool Overcoat",
    category: 'mens', price: '189.00', salePrice: '149.00', cost: '92.00',
    stock: 32, keyword: 'wool overcoat', sold: 58,
    reviews: { count: 22, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Cotton'],
    variants: [
      { options: ['Size:S'], stock: 6 },
      { suffix: 'M', options: ['Size:M'], stock: 11 },
      { suffix: 'L', options: ['Size:L'], stock: 10 },
      { suffix: 'XL', options: ['Size:XL'], stock: 5 },
    ],
    short: '70% wool, single breasted, knee length.',
    description: '<p>Seventy per cent wool, lined to the hem, and long enough to cover a suit jacket properly.</p>',
  },
  {
    name: "Men's Cargo Shorts",
    category: 'mens', price: '35.00', cost: '13.00',
    stock: 104, keyword: 'cargo shorts', sold: 167,
    reviews: { count: 51, average: 4 },
    attributes: ['Colour:Green', 'Material:Cotton'],
    short: 'Six pockets, cotton ripstop, 9" inseam.',
    description: '<p>Ripstop cotton with six pockets, two of them deep enough for a phone that will not fall out sitting down.</p>',
  },
  {
    name: "Men's Merino Crew Jumper",
    category: 'mens', price: '79.00', salePrice: '59.00', cost: '34.00',
    stock: 61, keyword: 'wool jumper', sold: 93,
    reviews: { count: 36, average: 4.5 },
    attributes: ['Colour:Blue'],
    short: '100% merino, machine washable.',
    description: '<p>Pure merino that goes in the machine on wool wash, which is what separates a jumper you wear from one you keep for best.</p>',
  },
  {
    name: "Women's Trench Coat",
    category: 'womens', price: '149.00', salePrice: '119.00', cost: '71.00',
    stock: 38, keyword: 'trench coat', sold: 74,
    reviews: { count: 28, average: 4.5 },
    attributes: ['Colour:Silver', 'Material:Cotton'],
    short: 'Water resistant cotton, belted, removable lining.',
    description: '<p>Water-resistant cotton gabardine with a lining that unbuttons, so it works from March through to November.</p>',
  },
  {
    name: "Women's Silk Blouse",
    category: 'womens', price: '89.00', cost: '42.00',
    stock: 44, keyword: 'silk blouse', sold: 61,
    reviews: { count: 21, average: 4 },
    attributes: ['Colour:White'],
    short: '100% mulberry silk, 19 momme.',
    description: '<p>Nineteen momme silk, which is heavy enough to hang properly rather than clinging to everything underneath.</p>',
  },
  {
    name: "Women's Pleated Midi Skirt",
    category: 'womens', price: '59.00', salePrice: '45.00', cost: '24.00',
    stock: 67, keyword: 'pleated skirt', newArrival: true, sold: 88,
    reviews: { count: 31, average: 4 },
    attributes: ['Colour:Green'],
    variants: [
      { options: ['Size:S'], stock: 16 },
      { suffix: 'M', options: ['Size:M'], stock: 24 },
      { suffix: 'L', options: ['Size:L'], stock: 19 },
      { suffix: 'XL', options: ['Size:XL'], stock: 8 },
    ],
    short: 'Permanent pleats, elasticated waist, midi.',
    description: '<p>Heat-set pleats that survive the wash, on an elasticated waist that does not need to be exactly the right size.</p>',
  },
  {
    name: 'Adidas Samba Trainers',
    category: 'shoes', brand: 'adidas', price: '89.00', cost: '43.00',
    stock: 52, keyword: 'samba sneakers', featured: true, sold: 289,
    reviews: { count: 97, average: 4.8 },
    attributes: ['Colour:White', 'Material:Leather'],
    short: 'Leather upper, gum sole, indoor football origin.',
    description: '<p>Designed in 1950 for training on frozen pitches, and worn since by everybody except footballers.</p>',
  },
  {
    name: "Men's Leather Loafers",
    category: 'shoes', price: '109.00', salePrice: '85.00', cost: '54.00',
    stock: 36, keyword: 'leather loafers', sold: 67,
    reviews: { count: 24, average: 4 },
    attributes: ['Colour:Black', 'Material:Leather'],
    short: 'Full grain, leather lined, rubber sole.',
    description: '<p>Leather lined so they mould to the foot, on a rubber sole that survives a pavement in a way a leather one does not.</p>',
  },
  {
    name: 'Waterproof Walking Boots',
    category: 'shoes', price: '129.00', cost: '68.00',
    stock: 43, keyword: 'hiking boots', sold: 96,
    reviews: { count: 42, average: 4.5 },
    attributes: ['Colour:Green', 'Material:Leather'],
    short: 'Waterproof membrane, ankle support, Vibram sole.',
    description: '<p>A waterproof membrane that still breathes, over a sole that grips wet rock — the two things a boot is bought for.</p>',
  },
  {
    name: "Men's Chronograph Watch Leather Strap",
    category: 'watches', price: '199.00', salePrice: '159.00', cost: '98.00',
    stock: 28, keyword: 'chronograph watch', sold: 54,
    reviews: { count: 19, average: 4.5 },
    attributes: ['Colour:Black', 'Material:Leather'],
    short: 'Quartz chronograph, 50m, sapphire.',
    description: '<p>A working chronograph under sapphire glass, on a leather strap that changes with a spring bar tool in a minute.</p>',
  },
  {
    name: 'Kids Digital Watch Waterproof',
    category: 'watches', price: '29.00', cost: '11.00',
    stock: 132, keyword: 'kids watch', sold: 178,
    reviews: { count: 54, average: 4 },
    attributes: ['Colour:Blue', 'Material:Plastic'],
    short: '5ATM, alarm, stopwatch, backlight.',
    description: '<p>Waterproof to five atmospheres, so swimming is fine, and cheap enough that losing it is not a disaster.</p>',
  },
  {
    name: 'Leather Belt Reversible',
    category: 'bags', price: '39.00', cost: '15.00',
    stock: 96, keyword: 'leather belt', sold: 142,
    reviews: { count: 46, average: 4 },
    attributes: ['Colour:Black', 'Material:Leather'],
    short: 'Black one side, brown the other. Rotating buckle.',
    description: '<p>The buckle turns, so it is black with a suit and brown with jeans, which is one belt instead of two.</p>',
  },
  {
    name: 'Travel Wallet RFID Blocking',
    category: 'bags', price: '29.00', salePrice: '22.00', cost: '11.00',
    stock: 148, keyword: 'travel wallet', sold: 196,
    reviews: { count: 62, average: 4.5 },
    attributes: ['Material:Leather'],
    short: 'Passport, cards, boarding pass, pen loop.',
    description: '<p>Holds two passports, the cards and a boarding pass, with RFID shielding in the card slots.</p>',
  },

  // ---- home & kitchen, continued -------------------------------------------
  {
    name: 'Espresso Machine 15 Bar',
    category: 'kitchen-appliances', price: '229.00', salePrice: '189.00', cost: '134.00',
    stock: 26, keyword: 'espresso machine', featured: true, sold: 87,
    reviews: { count: 43, average: 4.5 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    bundle: ['Philips Coffee Maker'],
    short: '15 bar pump, steam wand, 1.5L tank.',
    description: '<p>A real steam wand rather than a frothing gadget, which is the part that decides whether the milk is any good.</p>',
  },
  {
    name: 'Toaster 4-Slice Wide Slot',
    category: 'kitchen-appliances', price: '49.00', cost: '21.00',
    stock: 84, keyword: 'toaster', sold: 156,
    reviews: { count: 48, average: 4 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    short: 'Four slices, wide slots, removable crumb tray.',
    description: '<p>Slots wide enough for a crumpet or a doorstep of bloomer, and a crumb tray that actually slides out.</p>',
  },
  {
    name: 'Food Processor 1000W',
    category: 'kitchen-appliances', price: '129.00', salePrice: '99.00', cost: '67.00',
    stock: 31, keyword: 'food processor', sold: 74,
    reviews: { count: 29, average: 4 },
    short: '1000W, 2.5L bowl, six attachments.',
    description: '<p>A kilowatt and six discs, which turns a bag of vegetables into a stew in the time it takes to find the chopping board.</p>',
  },
  {
    name: 'Stainless Steel Saucepan Set (5-piece)',
    category: 'cookware', price: '99.00', salePrice: '79.00', cost: '46.00',
    stock: 42, keyword: 'saucepan set', sold: 108,
    reviews: { count: 37, average: 4.5 },
    attributes: ['Material:Stainless Steel'],
    short: 'Tri-ply base, glass lids, induction ready.',
    description: '<p>A tri-ply base that spreads the heat instead of scorching a ring into the middle, and it works on induction.</p>',
  },
  {
    name: 'Bamboo Chopping Board Set',
    category: 'cookware', price: '35.00', cost: '13.00',
    stock: 126, keyword: 'chopping board', sold: 189,
    reviews: { count: 57, average: 4 },
    short: 'Three sizes, juice groove, hanging holes.',
    description: '<p>Three sizes so the raw and the cooked never meet, with a groove that catches what comes off a roast.</p>',
  },
  {
    name: 'Glass Food Storage Containers (10-piece)',
    category: 'cookware', price: '45.00', salePrice: '35.00', cost: '19.00',
    stock: 97, keyword: 'food containers', sold: 213,
    reviews: { count: 68, average: 4.5 },
    short: 'Borosilicate, oven to freezer, leakproof lids.',
    description: '<p>Borosilicate glass goes from freezer to oven, and the lids clip on four sides so a bag survives a soup.</p>',
  },
  {
    name: 'Goose Down Pillow (Pair)',
    category: 'bedding', price: '89.00', cost: '41.00',
    stock: 53, keyword: 'down pillows', sold: 96,
    reviews: { count: 34, average: 4.5 },
    attributes: ['Colour:White', 'Material:Cotton'],
    short: 'Medium support, 233 thread cotton cover, pair.',
    description: '<p>Down and feather in a cambric cover tight enough that the quills stay inside, which is the usual complaint.</p>',
  },
  {
    name: 'Fitted Sheet Set Jersey (Double)',
    category: 'bedding', price: '39.00', cost: '15.00',
    stock: 118, keyword: 'bed sheets', sold: 167,
    reviews: { count: 52, average: 4 },
    attributes: ['Colour:Silver', 'Material:Cotton'],
    short: 'Jersey cotton, 35cm deep, no ironing.',
    description: '<p>Jersey cotton stretches over a deep mattress and comes out of the machine without needing an iron near it.</p>',
  },
  {
    name: 'Framed Botanical Print Set of 3',
    category: 'decor', price: '69.00', salePrice: '55.00', cost: '28.00',
    stock: 47, keyword: 'wall art frames', sold: 71,
    reviews: { count: 26, average: 4.5 },
    short: 'A3, solid wood frames, ready to hang.',
    description: '<p>Three A3 prints in solid wood frames with the hanging hardware fitted, so a blank wall is a ten-minute job.</p>',
  },
  {
    name: 'Woven Jute Rug 160 x 230cm',
    category: 'decor', price: '129.00', cost: '61.00',
    stock: 24, keyword: 'jute rug', sold: 48,
    reviews: { count: 18, average: 4 },
    short: 'Hand woven jute, reversible, 160 x 230cm.',
    description: '<p>Hand-woven and reversible, so the side that takes the sun can be swapped for the one that has not.</p>',
  },
  {
    name: 'Ceramic Vase Set (3-piece)',
    category: 'decor', price: '45.00', cost: '17.00',
    stock: 88, keyword: 'ceramic vases', newArrival: true, sold: 84,
    reviews: { count: 29, average: 4 },
    attributes: ['Colour:White'],
    short: 'Three heights, matte glaze, watertight.',
    description: '<p>Three heights that group properly on a shelf, glazed inside as well as out so they hold water rather than seeping.</p>',
  },

  // ---- beauty, continued ---------------------------------------------------
  {
    name: 'Vitamin C Brightening Toner',
    category: 'skincare', price: '22.00', cost: '7.00',
    stock: 164, keyword: 'face toner', sold: 218,
    reviews: { count: 71, average: 4 },
    short: '10% vitamin C, alcohol free, 200ml.',
    description: '<p>Ten per cent vitamin C with no alcohol in it, so it can be used morning and evening without the sting.</p>',
  },
  {
    name: 'Clay Face Mask 100ml',
    category: 'skincare', price: '18.00', cost: '5.00',
    stock: 187, keyword: 'face mask clay', sold: 246,
    reviews: { count: 78, average: 4.5 },
    short: 'Kaolin and charcoal, 10 minutes, 12 uses.',
    description: '<p>Kaolin and charcoal that dry in ten minutes rather than cracking on the face for half an hour.</p>',
  },
  {
    name: 'Eye Cream Caffeine 15ml',
    category: 'skincare', price: '24.00', salePrice: '19.00', cost: '8.00',
    stock: 143, keyword: 'eye cream', sold: 189,
    reviews: { count: 63, average: 4 },
    short: '5% caffeine, 15ml, fragrance free.',
    description: '<p>Caffeine at five per cent in a base light enough to go under makeup, with nothing in it that stings an eye.</p>',
  },
  {
    name: 'Curling Wand Tourmaline 32mm',
    category: 'haircare', price: '55.00', salePrice: '42.00', cost: '24.00',
    stock: 68, keyword: 'curling wand', sold: 124,
    reviews: { count: 47, average: 4 },
    attributes: ['Colour:Black'],
    short: '32mm barrel, 210°C, heat-proof glove.',
    description: '<p>A 32mm barrel for a loose curl, up to 210°C, and a glove in the box because a wand has no clip to hold.</p>',
  },
  {
    name: 'Scalp Massager & Detangling Brush',
    category: 'haircare', price: '16.00', cost: '5.00',
    stock: 213, keyword: 'hair brush', sold: 287,
    reviews: { count: 84, average: 4.5 },
    short: 'Silicone bristles, wet or dry, waterproof.',
    description: '<p>Silicone bristles that work in the shower on conditioner, which is where detangling is least painful.</p>',
  },
  {
    name: 'Safety Razor Double Edge',
    category: 'grooming', price: '39.00', cost: '16.00',
    stock: 92, keyword: 'safety razor', sold: 138,
    reviews: { count: 51, average: 4.5 },
    attributes: ['Colour:Silver', 'Material:Stainless Steel'],
    short: 'Butterfly open, 10 blades included, brass core.',
    description: '<p>A brass core weighted so it shaves under its own mass, and blades that cost pence rather than pounds.</p>',
  },
  {
    name: 'Nail Clipper & Manicure Set (12-piece)',
    category: 'grooming', price: '25.00', salePrice: '19.00', cost: '9.00',
    stock: 156, keyword: 'manicure set', sold: 194,
    reviews: { count: 58, average: 4 },
    attributes: ['Material:Stainless Steel'],
    short: 'Twelve tools, stainless, leather case.',
    description: '<p>Twelve stainless tools in a case that closes properly, which is the difference between a set and a drawer.</p>',
  },
  {
    name: 'Citrus Cologne 100ml',
    category: 'fragrance', price: '69.00', salePrice: '55.00', cost: '26.00',
    stock: 61, keyword: 'cologne bottle', sold: 92,
    reviews: { count: 33, average: 4 },
    short: 'Lemon, neroli, cedar. Light and sharp.',
    description: '<p>Lemon and neroli over cedar — a summer scent that does not turn sweet by the afternoon.</p>',
  },
  {
    name: 'Reed Diffuser 200ml Amber',
    category: 'fragrance', price: '32.00', cost: '12.00',
    stock: 134, keyword: 'reed diffuser', sold: 148,
    reviews: { count: 44, average: 4.5 },
    short: 'Amber and sandalwood, 200ml, 4 months.',
    description: '<p>Four months from a bottle with the reeds turned once a fortnight, and no flame to remember to put out.</p>',
  },

  // ---- sports & outdoors, continued ----------------------------------------
  {
    name: 'Kettlebell 16kg Cast Iron',
    category: 'fitness', price: '49.00', cost: '22.00',
    stock: 64, keyword: 'kettlebell', sold: 127,
    reviews: { count: 44, average: 4.5 },
    attributes: ['Colour:Black'],
    short: '16kg, vinyl coated base, wide handle.',
    description: '<p>A handle wide enough for two hands and a coated base that will not mark a floor when it comes down.</p>',
  },
  {
    name: 'Skipping Rope Weighted',
    category: 'fitness', price: '19.00', cost: '6.00',
    stock: 218, keyword: 'skipping rope', sold: 264,
    reviews: { count: 76, average: 4 },
    short: 'Weighted handles, ball bearings, 3m adjustable.',
    description: '<p>Ball-bearing handles so the rope turns rather than twisting, adjustable down to whatever height you are.</p>',
  },
  {
    name: 'Exercise Bike Magnetic Resistance',
    category: 'fitness', price: '349.00', salePrice: '289.00', cost: '196.00',
    stock: 13, keyword: 'exercise bike', sold: 41,
    reviews: { count: 24, average: 4 },
    short: '16 resistance levels, 8kg flywheel, near silent.',
    description: '<p>Magnetic resistance means nothing touches the flywheel, so it is quiet enough to use while somebody else is watching television.</p>',
  },
  {
    name: 'Laptop Backpack Anti-Theft 25L',
    category: 'backpacks', price: '65.00', salePrice: '49.00', cost: '28.00',
    stock: 87, keyword: 'laptop backpack', sold: 176,
    reviews: { count: 64, average: 4.5 },
    attributes: ['Colour:Black'],
    short: '25L, hidden zips, USB pass-through, 15.6" sleeve.',
    description: '<p>Zips that face the back panel where nobody can reach them, and a padded sleeve that takes a 15.6-inch laptop.</p>',
  },
  {
    name: 'Packable Daypack 20L',
    category: 'backpacks', price: '29.00', cost: '11.00',
    stock: 164, keyword: 'foldable backpack', sold: 198,
    reviews: { count: 57, average: 4 },
    attributes: ['Colour:Blue'],
    short: '20L, folds into its own pocket, 180g.',
    description: '<p>A hundred and eighty grams that folds into its own pocket, so it lives in a suitcase until the day it is needed.</p>',
  },
  {
    name: 'Hydration Bladder 2L',
    category: 'hydration', price: '27.00', cost: '10.00',
    stock: 112, keyword: 'hydration pack', sold: 89,
    reviews: { count: 31, average: 4 },
    short: '2L, wide fill opening, bite valve, BPA free.',
    description: '<p>An opening wide enough to get a hand inside for cleaning, which is the reason most bladders get thrown away.</p>',
  },
  {
    name: 'Protein Shaker Bottle 700ml',
    category: 'hydration', price: '12.00', cost: '4.00',
    stock: 243, keyword: 'shaker bottle', sold: 312,
    reviews: { count: 88, average: 4 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    short: '700ml, wire whisk ball, leakproof.',
    description: '<p>A wire ball rather than a mesh, because the mesh is what holds the smell after a fortnight.</p>',
  },
  {
    name: 'LED Camping Lantern Rechargeable',
    category: 'camping', price: '32.00', salePrice: '25.00', cost: '12.00',
    stock: 128, keyword: 'camping lantern', sold: 173,
    reviews: { count: 54, average: 4.5 },
    short: '1000 lumens, 30 hours, power bank out.',
    description: '<p>Thirty hours on low and a USB socket on the side, so it charges a phone when the light is not needed.</p>',
  },
  {
    name: 'Self-Inflating Sleeping Mat',
    category: 'camping', price: '59.00', cost: '26.00',
    stock: 56, keyword: 'sleeping mat', sold: 78,
    reviews: { count: 27, average: 4 },
    attributes: ['Colour:Green'],
    short: '5cm thick, self-inflating, R-value 4.',
    description: '<p>Five centimetres of open-cell foam that pulls its own air in, and an R-value that holds up on cold ground.</p>',
  },

  // ---- toys & games, continued ---------------------------------------------
  {
    name: 'STEM Robot Building Kit',
    category: 'building-toys', price: '69.00', salePrice: '55.00', cost: '29.00',
    stock: 58, keyword: 'robot toy kit', newArrival: true, sold: 96,
    reviews: { count: 38, average: 4.5 },
    short: '12 builds, app coding, ages 8+.',
    description: '<p>Twelve builds from one box, each of them programmable from a tablet, which is where the second hour comes from.</p>',
  },
  {
    name: 'Wooden Marble Run (120 pieces)',
    category: 'building-toys', price: '54.00', cost: '23.00',
    stock: 47, keyword: 'marble run toy', sold: 72,
    reviews: { count: 26, average: 4.5 },
    short: '120 beech pieces, 30 marbles.',
    description: '<p>Beech blocks cut precisely enough that a run holds together, with thirty marbles because they do go missing.</p>',
  },
  {
    name: 'RC Boat High Speed 2.4GHz',
    category: 'rc-toys', price: '79.00', cost: '34.00',
    stock: 39, keyword: 'rc boat', sold: 63,
    reviews: { count: 24, average: 4 },
    attributes: ['Colour:Red'],
    short: '30 km/h, self-righting hull, 2 batteries.',
    description: '<p>A self-righting hull, which means capsizing it is a pause rather than a swim.</p>',
  },
  {
    name: 'RC Excavator Metal 1:14',
    category: 'rc-toys', price: '149.00', salePrice: '119.00', cost: '68.00',
    stock: 21, keyword: 'toy excavator', sold: 38,
    reviews: { count: 16, average: 4.5 },
    attributes: ['Material:Aluminium'],
    short: '1:14, metal bucket, 11 functions.',
    description: '<p>A metal bucket on eleven separate functions, which digs actual holes in actual soil rather than miming it.</p>',
  },
  {
    name: 'Jigsaw Puzzle 1000 Pieces',
    category: 'board-games', price: '18.00', cost: '6.00',
    stock: 187, keyword: 'jigsaw puzzle', sold: 241,
    reviews: { count: 72, average: 4.5 },
    short: '1000 pieces, 68 x 48cm, poster included.',
    description: '<p>Thick board that does not delaminate, and a poster in the box so the picture is not stuck on the lid all evening.</p>',
  },
  {
    name: 'Dominoes Set Double Six',
    category: 'board-games', price: '24.00', cost: '9.00',
    stock: 96, keyword: 'dominoes', sold: 84,
    reviews: { count: 27, average: 4 },
    short: '28 tiles, spinner pins, wooden case.',
    description: '<p>Twenty-eight weighted tiles with spinner pins, in a wooden case rather than the tin that eventually splits.</p>',
  },

  // ---- tools & home improvement, continued ---------------------------------
  {
    name: 'Jigsaw 700W Variable Speed',
    category: 'power-tools', price: '69.00', salePrice: '55.00', cost: '31.00',
    stock: 44, keyword: 'jigsaw power tool', sold: 71,
    reviews: { count: 26, average: 4 },
    short: '700W, tool-free blade change, laser guide.',
    description: '<p>Blades change without a hex key, which matters because a blunt jigsaw blade is what burns a cut.</p>',
  },
  {
    name: 'Impact Driver 18V Brushless',
    category: 'power-tools', price: '129.00', cost: '68.00',
    stock: 32, keyword: 'impact driver', sold: 58,
    reviews: { count: 23, average: 4.8 },
    attributes: ['Colour:Blue'],
    bundle: ['Cordless Drill 20V'],
    short: 'Brushless, 180Nm, two batteries.',
    description: '<p>A hundred and eighty newton metres will drive a 100mm screw into a joist without a pilot hole, and brushless means it does it all day.</p>',
  },
  {
    name: 'Spirit Level 120cm Aluminium',
    category: 'hand-tools', price: '32.00', cost: '13.00',
    stock: 76, keyword: 'spirit level', sold: 89,
    reviews: { count: 31, average: 4.5 },
    attributes: ['Material:Aluminium'],
    short: '120cm, three vials, milled base.',
    description: '<p>A milled base rather than an extruded one, which is what makes a level accurate over the whole 120 centimetres.</p>',
  },
  {
    name: 'Screwdriver Set (32-piece) Precision',
    category: 'hand-tools', price: '29.00', salePrice: '22.00', cost: '11.00',
    stock: 138, keyword: 'precision screwdriver', sold: 187,
    reviews: { count: 62, average: 4.5 },
    attributes: ['Material:Stainless Steel'],
    short: '32 bits, magnetic, for phones and laptops.',
    description: '<p>Thirty-two bits including the pentalobe and tri-point ones, which is what a phone actually needs opening.</p>',
  },
  {
    name: 'Tool Organiser Trolley 3-Tier',
    category: 'tool-storage', price: '89.00', salePrice: '69.00', cost: '38.00',
    stock: 34, keyword: 'tool trolley', sold: 47,
    reviews: { count: 18, average: 4 },
    attributes: ['Colour:Black'],
    short: 'Three trays, locking castors, 60kg.',
    description: '<p>Three deep trays on castors that lock, so the tools follow the job round the garage instead of staying on the bench.</p>',
  },
  {
    name: 'Small Parts Organiser (24 bins)',
    category: 'tool-storage', price: '35.00', cost: '14.00',
    stock: 92, keyword: 'parts organiser', sold: 76,
    reviews: { count: 24, average: 4 },
    attributes: ['Material:Plastic'],
    short: '24 removable bins, wall mountable.',
    description: '<p>Bins that lift out to take to the job, in a frame that hangs on a wall rather than taking up a shelf.</p>',
  },

  // ---- automotive, continued -----------------------------------------------
  {
    name: 'Reversing Camera Kit Wireless',
    category: 'car-electronics', price: '89.00', salePrice: '69.00', cost: '41.00',
    stock: 48, keyword: 'reversing camera', sold: 94,
    reviews: { count: 36, average: 4 },
    short: '4.3" monitor, IP68 camera, wireless link.',
    description: '<p>The camera wires to the reversing light and the monitor to the cigarette socket, so there is no cable to run down the car.</p>',
  },
  {
    name: 'OBD2 Diagnostic Scanner Bluetooth',
    category: 'car-electronics', price: '45.00', cost: '18.00',
    stock: 116, keyword: 'obd scanner', sold: 168,
    reviews: { count: 58, average: 4.5 },
    short: 'Reads and clears fault codes, live data.',
    description: '<p>Reads the code behind the engine light and clears it once it is fixed, which is a garage visit for most people.</p>',
  },
  {
    name: 'Microfibre Drying Towel XL',
    category: 'car-care', price: '22.00', cost: '8.00',
    stock: 174, keyword: 'microfibre towel', sold: 216,
    reviews: { count: 67, average: 4.5 },
    short: '90 x 60cm, 1200gsm, twisted loop.',
    description: '<p>Twelve hundred gsm of twisted loop dries a whole car without wringing, and leaves nothing behind on glass.</p>',
  },
  {
    name: 'Windscreen Wiper Blades (Pair) 24"',
    category: 'car-care', price: '25.00', cost: '10.00',
    stock: 152, keyword: 'wiper blades', sold: 234,
    reviews: { count: 74, average: 4 },
    short: 'Flat beam, graphite coated, 8 adaptors.',
    description: '<p>Flat beam blades press evenly across the whole curve of a screen, and there are eight adaptors so they fit nearly anything.</p>',
  },
  {
    name: 'Car Boot Organiser Collapsible',
    category: 'car-accessories', price: '29.00', salePrice: '22.00', cost: '11.00',
    stock: 128, keyword: 'boot organiser', sold: 163,
    reviews: { count: 49, average: 4 },
    attributes: ['Colour:Black'],
    short: 'Three compartments, folds flat, non-slip base.',
    description: '<p>Stops the shopping travelling on a roundabout, and folds flat against the side when the boot is needed for something bigger.</p>',
  },
  {
    name: 'Roof Bars Universal Lockable',
    category: 'car-accessories', price: '119.00', cost: '62.00',
    stock: 27, keyword: 'roof rack bars', sold: 43,
    reviews: { count: 17, average: 4 },
    attributes: ['Material:Aluminium'],
    short: '75kg rated, lockable clamps, fits rails.',
    description: '<p>Seventy-five kilos on lockable clamps, which is a roof box, two bikes or a very optimistic amount of timber.</p>',
  },

  // ---- books & stationery, continued ---------------------------------------
  {
    name: 'The Cartographer of Small Things — Paperback',
    category: 'fiction', price: '13.00', cost: '5.00',
    stock: 148, keyword: 'paperback book', sold: 172,
    reviews: { count: 54, average: 4.5 },
    short: 'Literary fiction. 296 pages, paperback.',
    description: '<p>Two hundred and ninety-six pages about a woman who maps places that are about to be demolished.</p>',
  },
  {
    name: 'Salt and Iron — Fantasy Paperback',
    category: 'fiction', price: '15.00', salePrice: '11.00', cost: '6.00',
    stock: 121, keyword: 'fantasy book', sold: 198,
    reviews: { count: 63, average: 4 },
    short: 'Fantasy, book one of three. 512 pages.',
    description: '<p>The first of three, and it finishes its own story rather than stopping — which is rarer than it should be.</p>',
  },
  {
    name: 'A Short History of Everyday Things — Hardback',
    category: 'non-fiction', price: '24.00', cost: '9.00',
    stock: 78, keyword: 'history book', sold: 116,
    reviews: { count: 42, average: 4.5 },
    short: 'Popular history. 368 pages, hardback.',
    description: '<p>Where the fork, the pocket and the postbox came from, in chapters short enough to read one at a time.</p>',
  },
  {
    name: 'The Home Cook Handbook — Hardback',
    category: 'non-fiction', price: '32.00', salePrice: '25.00', cost: '13.00',
    stock: 64, keyword: 'cookbook', sold: 143,
    reviews: { count: 51, average: 4.5 },
    short: '180 recipes, 400 pages, lies flat.',
    description: '<p>A hundred and eighty recipes in a binding that stays open on the counter, which is the only binding a cookbook should have.</p>',
  },
  {
    name: 'Desk Organiser Set Bamboo',
    category: 'stationery', price: '39.00', cost: '15.00',
    stock: 104, keyword: 'desk organiser', sold: 87,
    reviews: { count: 29, average: 4 },
    short: 'Five pieces, bamboo, phone stand included.',
    description: '<p>Five pieces that group rather than clutter, including a slot that holds a phone upright while it charges.</p>',
  },
  {
    name: 'Gel Pen Set (24 colours)',
    category: 'stationery', price: '16.00', cost: '5.00',
    stock: 217, keyword: 'coloured pens', sold: 268,
    reviews: { count: 79, average: 4 },
    short: '24 colours, 0.5mm, quick dry.',
    description: '<p>Quick-drying ink at 0.5mm, so a left-handed hand does not drag the last word through the next one.</p>',
  },

  // ---- health & wellness, continued ----------------------------------------
  {
    name: 'Omega-3 Fish Oil (180 capsules)',
    category: 'supplements', price: '29.00', salePrice: '22.00', cost: '11.00',
    stock: 186, keyword: 'fish oil capsules', sold: 254,
    reviews: { count: 76, average: 4 },
    short: '1000mg, 180 capsules, no repeat.',
    description: '<p>Enteric coated, which is what stops the aftertaste that makes most people give up by the second week.</p>',
  },
  {
    name: 'Magnesium Glycinate (90 capsules)',
    category: 'supplements', price: '24.00', cost: '9.00',
    stock: 163, keyword: 'magnesium supplement', sold: 217,
    reviews: { count: 68, average: 4.5 },
    short: '400mg elemental, 90 capsules, chelated.',
    description: '<p>Glycinate rather than oxide, which is absorbed rather than passing straight through.</p>',
  },
  {
    name: 'Digital Bathroom Scale Body Composition',
    category: 'wellness-devices', price: '39.00', salePrice: '29.00', cost: '16.00',
    stock: 128, keyword: 'bathroom scale', sold: 196,
    reviews: { count: 62, average: 4 },
    attributes: ['Colour:Black', 'Material:Plastic'],
    short: '13 metrics, app sync, 8 users.',
    description: '<p>Thirteen readings that sync to a phone, and it recognises which of eight people is standing on it.</p>',
  },
  {
    name: 'Infrared Thermometer Non-Contact',
    category: 'wellness-devices', price: '32.00', cost: '13.00',
    stock: 147, keyword: 'infrared thermometer', sold: 178,
    reviews: { count: 54, average: 4 },
    short: 'One second, forehead or object, silent mode.',
    description: '<p>A reading in a second without touching, and a silent mode for the child you do not want to wake up.</p>',
  },
  {
    name: 'Yoga Wheel 33cm',
    category: 'yoga', price: '35.00', cost: '14.00',
    stock: 82, keyword: 'yoga wheel', sold: 74,
    reviews: { count: 26, average: 4.5 },
    attributes: ['Colour:Blue'],
    short: '33cm, 150kg rated, padded surface.',
    description: '<p>Rated to a hundred and fifty kilos, padded where the spine goes, and it opens a chest that has been at a desk all week.</p>',
  },
  {
    name: 'Foam Roller Textured 45cm',
    category: 'yoga', price: '28.00', salePrice: '22.00', cost: '11.00',
    stock: 136, keyword: 'foam roller', sold: 168,
    reviews: { count: 57, average: 4 },
    attributes: ['Colour:Black'],
    short: '45cm, hollow core, textured surface.',
    description: '<p>A hollow core keeps it firm under weight, and the texture works into a knot instead of rolling over it.</p>',
  },

  // ---- pet supplies, continued ---------------------------------------------
  {
    name: 'Dog Chew Toy Set (5-piece)',
    category: 'dog', price: '25.00', cost: '9.00',
    stock: 184, keyword: 'dog toys', sold: 243,
    reviews: { count: 72, average: 4 },
    short: 'Five toys, natural rubber, treat holes.',
    description: '<p>Natural rubber with holes that take peanut butter, which is what buys twenty minutes of quiet.</p>',
  },
  {
    name: 'Dog Travel Crate Foldable',
    category: 'dog', price: '69.00', salePrice: '55.00', cost: '29.00',
    stock: 43, keyword: 'dog crate', sold: 68,
    reviews: { count: 24, average: 4.5 },
    short: 'Folds flat, two doors, washable tray.',
    description: '<p>Folds flat in about ten seconds and has a tray that slides out, which is the part that gets washed most.</p>',
  },
  {
    name: 'Cat Scratching Post 60cm',
    category: 'cat', price: '35.00', cost: '14.00',
    stock: 118, keyword: 'scratching post', sold: 194,
    reviews: { count: 61, average: 4 },
    short: '60cm sisal, weighted base, dangling toy.',
    description: '<p>Tall enough for a full stretch, which is the reason a cat picks the sofa over a short one.</p>',
  },
  {
    name: 'Interactive Cat Laser Toy',
    category: 'cat', price: '29.00', cost: '11.00',
    stock: 156, keyword: 'cat toy', sold: 187,
    reviews: { count: 58, average: 4 },
    short: 'Automatic, random pattern, 15-minute timer.',
    description: '<p>Runs a random pattern for fifteen minutes then stops itself, so the cat gets exercise and the room gets peace.</p>',
  },
  {
    name: 'Pet Carrier Backpack Ventilated',
    category: 'pet-accessories', price: '59.00', salePrice: '45.00', cost: '24.00',
    stock: 67, keyword: 'pet carrier', sold: 96,
    reviews: { count: 34, average: 4 },
    attributes: ['Colour:Green'],
    short: 'Mesh on three sides, up to 8kg, airline friendly.',
    description: '<p>Mesh on three sides so it stays cool, and small enough to go under an aeroplane seat.</p>',
  },
  {
    name: 'Silicone Pet Food Mat & Bowls',
    category: 'pet-accessories', price: '22.00', cost: '8.00',
    stock: 172, keyword: 'pet bowls', sold: 214,
    reviews: { count: 64, average: 4.5 },
    short: 'Raised lip mat, two stainless bowls.',
    description: '<p>A raised lip that keeps water on the mat instead of the floor, with two stainless bowls that lift out to wash.</p>',
  },

  // ---- garden & outdoor, continued -----------------------------------------
  {
    name: 'Pressure Washer 1800W',
    category: 'garden-tools', price: '159.00', salePrice: '129.00', cost: '82.00',
    stock: 31, keyword: 'pressure washer', featured: true, sold: 74,
    reviews: { count: 32, average: 4.5 },
    short: '135 bar, patio head, 8m hose.',
    description: '<p>A hundred and thirty-five bar with a rotating patio head, which cleans a drive in an hour rather than an afternoon.</p>',
  },
  {
    name: 'Garden Kneeler & Seat Folding',
    category: 'garden-tools', price: '39.00', cost: '16.00',
    stock: 94, keyword: 'garden kneeler', sold: 87,
    reviews: { count: 31, average: 4.5 },
    short: 'Flips between kneeler and seat, tool pouches.',
    description: '<p>Turns over to be either a padded kneeler or a seat, and the handles are what get you back up.</p>',
  },
  {
    name: 'Wooden Garden Bench 3-Seater',
    category: 'outdoor-furniture', price: '179.00', cost: '92.00',
    stock: 19, keyword: 'garden bench', sold: 36,
    reviews: { count: 14, average: 4 },
    short: 'FSC acacia, 150cm, pre-oiled.',
    description: '<p>FSC acacia that arrives already oiled, and needs doing again once a year to stay that colour.</p>',
  },
  {
    name: 'Hanging Egg Chair with Stand',
    category: 'outdoor-furniture', price: '299.00', salePrice: '249.00', cost: '158.00',
    stock: 12, keyword: 'hanging egg chair', newArrival: true, sold: 28,
    reviews: { count: 16, average: 4.5 },
    short: 'PE rattan, steel stand, cushion included.',
    description: '<p>The stand takes 150kg and the cushion comes with it, so there is nothing else to buy before sitting in it.</p>',
  },
  {
    name: 'Indoor Plant Grow Light Full Spectrum',
    category: 'plants', price: '45.00', salePrice: '35.00', cost: '18.00',
    stock: 108, keyword: 'grow light', sold: 124,
    reviews: { count: 43, average: 4 },
    short: 'Full spectrum, timer, clip mount.',
    description: '<p>Full spectrum on a timer that remembers, which is what keeps a houseplant alive through a British January.</p>',
  },
  {
    name: 'Terracotta Pot Set (5-piece)',
    category: 'plants', price: '32.00', cost: '12.00',
    stock: 143, keyword: 'plant pots', sold: 152,
    reviews: { count: 47, average: 4.5 },
    short: 'Five sizes, drainage holes, saucers.',
    description: '<p>Unglazed terracotta breathes, which is why it is harder to overwater a plant in one, and the saucers are included.</p>',
  },
  {
    name: 'Wildflower Seed Mix 500g',
    category: 'plants', price: '19.00', cost: '6.00',
    stock: 196, keyword: 'wildflower seeds', sold: 218,
    reviews: { count: 66, average: 4 },
    short: '30 native species, covers 100m².',
    description: '<p>Thirty native species over a hundred square metres, chosen for pollinators rather than for the photograph on the packet.</p>',
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

// --------------------------------------------------------------- reviews ----

const REVIEWERS = [
  'Sarah M.', 'James P.', 'Aisha K.', 'Daniel R.', 'Priya S.', 'Tom H.', 'Elena V.', 'Marcus B.',
  'Nadia F.', 'Chris L.', 'Yuki T.', 'Omar A.', 'Grace W.', 'Liam O.', 'Sofia G.', 'Ravi N.',
  'Hannah B.', 'Diego M.', 'Chloe D.', 'Ahmed Z.', 'Laura C.', 'Kenji I.', 'Maya J.', 'Peter S.',
];

const PRAISE = [
  'Exactly what I was after. Arrived quickly and well packed.',
  'Better than I expected for the money. Would buy again.',
  'Been using it daily for a month now and it has held up perfectly.',
  'Great quality. Does everything it says it does.',
  'Really pleased with this. Delivery was fast too.',
  'Excellent build quality — feels far more expensive than it was.',
  'Bought one for myself and ended up ordering a second as a gift.',
];

const MIXED = [
  'Good overall, though it took a little getting used to.',
  'Does the job well. Packaging could have been better.',
  'Happy with it, but I would have liked more colour options.',
  'Works as described. Nothing remarkable, nothing wrong with it.',
];

const CRITICAL = [
  'Fine for the price, but not quite what I pictured from the photos.',
  'Arrived later than expected and the box was a bit knocked about.',
  'It works, though I think it is slightly overpriced for what it is.',
];

/**
 * A star distribution of `count` reviews that averages close to `target`.
 *
 * Built rather than randomised so a re-run produces the same shopfront, and
 * weighted the way real ratings skew — mostly fives, a tail of ones — because an
 * even spread averaging 4.5 would put an implausible number of 3s on the
 * distribution bars the product page draws.
 */
function distribution(count: number, target: number): number[] {
  const weights =
    target >= 4.7
      ? [0.82, 0.14, 0.02, 0.01, 0.01]
      : target >= 4.3
        ? [0.6, 0.32, 0.05, 0.02, 0.01]
        : target >= 3.8
          ? [0.4, 0.35, 0.15, 0.07, 0.03]
          : [0.25, 0.3, 0.25, 0.13, 0.07];

  const stars: number[] = [];
  // 5★ first, then 4★, and so on; the largest bucket absorbs the rounding.
  const counts = weights.map((weight) => Math.round(weight * count));
  const drift = count - counts.reduce((total, n) => total + n, 0);
  counts[0] = (counts[0] ?? 0) + drift;

  counts.forEach((n, index) => {
    for (let i = 0; i < Math.max(n, 0); i += 1) stars.push(5 - index);
  });

  return stars.slice(0, count);
}

function reviewBody(rating: number, index: number): string {
  const pool = rating >= 5 ? PRAISE : rating === 4 ? MIXED : CRITICAL;
  return pool[index % pool.length]!;
}

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

  /**
   * Every row on every page, read before anything is deleted.
   *
   * `pageSize` is capped at 100 and the catalogue is well past that, so a single
   * request removed the first hundred products and silently left the rest — the
   * worst kind of reset, because the next seed would then build on top of what
   * it believed it had cleared. Deleting cannot drive the paging either: a
   * product that has sold is *archived* rather than removed and stays in the
   * list, so "keep asking for page 1 until it is empty" never terminates. The
   * whole list is collected first, and the pages therefore do not shift
   * underneath the loop.
   */
  async function everyPage(
    path: string,
  ): Promise<Array<{ id: string; name?: string; code?: string; title?: string }>> {
    const rows: Array<{ id: string; name?: string; code?: string; title?: string }> = [];
    for (let page = 1; ; page += 1) {
      const list = await call(`${path}?page=${page}&pageSize=100`);
      const batch = (list.body?.data ?? []) as typeof rows;
      rows.push(...batch);
      if (batch.length === 0 || page >= Number(list.body?.meta?.totalPages ?? 1)) return rows;
    }
  }

  if (RESET) {
    console.log('Removing everything a previous run created…');
    for (const path of ['/products', '/categories', '/brands', '/banners', '/coupons']) {
      for (const row of await everyPage(path)) {
        const gone = await call(`${path}/${row.id}`, { method: 'DELETE' });
        const ok = gone.status === 204 || gone.status === 200;
        // A product with orders behind it answers 200 and `deleted: false` — it
        // was hidden, not removed, so saying "removed" would be a lie the next
        // run contradicts.
        const verb = !ok ? 'kept    ' : gone.body?.data?.deleted === false ? 'archived' : 'removed ';
        console.log(`  ${verb}${path.slice(1)} ${row.name ?? row.code ?? row.title ?? row.id}`);
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

  // ---- the shop's own identity --------------------------------------------
  console.log('Store settings');
  const currentSettings = await call('/settings');
  const settings = currentSettings.body?.data ?? {};
  const savedSettings = await call('/settings', {
    method: 'PUT',
    body: {
      ...settings,
      storeName: 'ShopMart',
      currency: 'USD',
      language: settings.language ?? 'en',
      timezone: settings.timezone ?? 'UTC',
      seoTitle: 'ShopMart — Your one-stop shop for the best products online',
      seoDescription:
        'Electronics, fashion, home and more at unbeatable prices. Free shipping on orders over $100.',
      businessName: settings.businessName ?? 'ShopMart Retail Ltd.',
      businessEmail: settings.businessEmail ?? 'support@shopmart.example',
      businessPhone: settings.businessPhone ?? '+1 555 0100',
      businessAddress: settings.businessAddress ?? '221 Market Street, Springfield, 62704',
      /*
       * The floating support button, which needs a number before it renders.
       *
       * No second language or currency is seeded, and that is not an omission.
       * `loadStoreCurrency` ignores the `?currency=` the storefront sends and
       * answers in the store's own currency, and no text is translated — so a
       * second entry in either list would draw a selector that changes a label
       * and nothing else. The selectors are built and correct; they hide
       * themselves because this store genuinely trades in one currency, and a
       * control that cannot do anything is worse than no control. `PUT
       * /settings` collapses both lists to the store's own values for the same
       * reason, so seeding them here would be overwritten anyway.
       */
      whatsappNumber: '+15550100',
      whatsappEnabled: true,
    },
  });
  report('ShopMart', savedSettings.status, savedSettings.body);

  console.log('\nDesign and announcement bar');
  const currentDesign = await call('/website/design');
  const design = currentDesign.body?.data ?? {};
  const savedDesign = await call('/website/design', {
    method: 'PUT',
    body: {
      ...design,
      templateKey: 'modern_shop',
      colorThemeKey: 'royal_blue',
      logoUrl: photo('shopping bag logo', 950, 240),
      faviconUrl: photo('shopping bag logo', 950, 64),
      tagline: 'Your one-stop shop for the best products online.',
      announcement: {
        enabled: true,
        messages: [
          { text: 'Free Shipping on orders over $100!', linkUrl: '/shop', linkLabel: null },
          { text: 'Summer Sale — up to 50% off selected items', linkUrl: '/sale', linkLabel: null },
          { text: 'New arrivals land every week', linkUrl: '/new-arrivals', linkLabel: null },
        ],
      },
      // Four of the five things the storefront used to hard-code. Category
      // glyphs are the fifth and are keyed by slug — which the API derives, and
      // may suffix on a collision — so they are written once the rows exist.
      social: SOCIAL,
      footerColumns: FOOTER_COLUMNS,
      utility: UTILITY,
      mobileNav: MOBILE_NAV,
    },
  });
  report('modern_shop / royal_blue + 3 notices + footer, social, utility, thumb bar', savedDesign.status, savedDesign.body);

  // ---- taxonomy -----------------------------------------------------------
  console.log('\nCategories');
  const categoryIds = new Map<string, string>();
  let childCount = 0;
  for (const [index, category] of CATEGORIES.entries()) {
    const id = await ensure('/categories', 'name', category.name, {
      name: category.name,
      imageUrl: photo(category.keyword, 500 + index, 400),
      isActive: true,
      showInMenu: true,
      sortOrder: index * 10,
    });
    if (!id) continue;
    categoryIds.set(category.key, id);

    // Children are created after the parent exists, because `parentId` has to
    // point at a real row — there is no foreign key to catch it if it does not.
    for (const [position, child] of category.children.entries()) {
      const childId = await ensure('/categories', 'name', child.name, {
        name: child.name,
        parentId: id,
        imageUrl: photo(child.keyword, 700 + index * 10 + position, 400),
        isActive: true,
        showInMenu: true,
        sortOrder: position * 10,
      });
      if (childId) {
        categoryIds.set(child.key, childId);
        childCount += 1;
      }
    }
  }
  console.log(`  ${CATEGORIES.length} departments, ${childCount} subcategories`);

  /*
   * Department glyphs, keyed by the slug the API actually derived rather than
   * one guessed from the name — `slugify` suffixes a clash, so a store that
   * already had a "Fashion" category gets `fashion-2` and a guessed key would
   * silently match nothing.
   */
  const savedCategories = await call('/categories?pageSize=100');
  const iconsBySlug: Record<string, string> = {};
  for (const row of (savedCategories.body?.data ?? []) as Array<{ slug: string }>) {
    const icon = CATEGORY_ICONS[row.slug];
    if (icon) iconsBySlug[row.slug] = icon;
  }

  if (Object.keys(iconsBySlug).length > 0) {
    const withIcons = await call('/website/design');
    const saved = await call('/website/design', {
      method: 'PUT',
      body: { ...(withIcons.body?.data ?? {}), categoryIcons: iconsBySlug },
    });
    report(`${Object.keys(iconsBySlug).length} department icons`, saved.status, saved.body);
  }

  console.log('\nBrands');
  const brandIds = new Map<string, string>();
  for (const [index, brand] of BRANDS.entries()) {
    const id = await ensure('/brands', 'name', brand.name, {
      name: brand.name,
      logoUrl: photo(brand.keyword, 900 + index, 200),
      isActive: true,
      isFeatured: true,
      sortOrder: index * 10,
    });
    if (id) brandIds.set(brand.key, id);
  }

  console.log('\nAttributes');
  /** `Colour:Black` → the attribute value's id. */
  const attributeValueIds = new Map<string, string>();
  for (const [index, attribute] of ATTRIBUTES.entries()) {
    await ensure('/attributes', 'name', attribute.name, {
      name: attribute.name,
      inputType: attribute.inputType,
      // Descriptive rather than variant-forming: these narrow a listing, they do
      // not split a product into separately buyable rows.
      isVariantAttribute: false,
      isFilterable: true,
      sortOrder: index * 10,
      values: attribute.values,
    });
  }

  // Re-read rather than trusting the create response: on a second run the
  // attributes already existed and `ensure` returned only their ids.
  const attributeList = await call('/attributes?pageSize=100');
  for (const row of (attributeList.body?.data ?? []) as Array<{
    name: string;
    values?: Array<{ id: string; value: string }>;
  }>) {
    for (const value of row.values ?? []) {
      attributeValueIds.set(`${row.name}:${value.value}`, value.id);
    }
  }
  console.log(`  ${attributeValueIds.size} attribute values available`);

  // ---- catalogue ----------------------------------------------------------
  console.log('\nProducts');
  const warehouses = await call('/warehouses');
  const warehouseId = (warehouses.body?.data ?? [])[0]?.id as string | undefined;

  /** SKU → product id, so reviews and sold counts can find their rows after. */
  const productIds = new Map<string, string>();

  for (const [index, product] of PRODUCTS.entries()) {
    const sku = `SM-${String(index + 1).padStart(3, '0')}`;
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
        brandId: product.brand ? (brandIds.get(product.brand) ?? null) : null,
        shortDescription: product.short,
        description: product.description,
        imageUrl: photo(product.keyword, 100 + index),
        isFeatured: product.featured ?? false,
        isNewArrival: product.newArrival ?? false,
        seoTitle: `${product.name} — ${product.short}`,
        seoDescription: product.short,
      },
    });

    if (report(`${product.name}  (${sku})`, result.status, result.body)) {
      productIds.set(sku, String(result.body.data.id));
    } else {
      // A second run: find the id so reviews and sold counts still land.
      const found = await call(`/products?search=${encodeURIComponent(product.name)}&pageSize=5`);
      const match = ((found.body?.data ?? []) as Array<{ id: string; name: string }>).find(
        (row) => row.name === product.name,
      );
      if (match) productIds.set(sku, match.id);
      continue;
    }

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

  // ---- gallery, specifications, filterable attributes ---------------------
  //
  // A second pass so it runs for products this seed created *and* products a
  // previous run left behind — all three are whole-list replacements, so a
  // re-run converges rather than accumulating.
  console.log('\nGallery, specifications and attributes');
  let enriched = 0;
  for (const [index, product] of PRODUCTS.entries()) {
    const sku = `SM-${String(index + 1).padStart(3, '0')}`;
    const id = productIds.get(sku);
    if (!id) continue;

    /*
     * Existing products are re-filed as well as new ones.
     *
     * A product that already exists is skipped by the create step, so moving the
     * catalogue onto subcategories would otherwise only apply to a store seeded
     * from empty — and the demo store, which is the one being looked at, would
     * keep every product on a top-level department.
     */
    const wantedCategory = categoryIds.get(product.category) ?? null;
    if (wantedCategory) {
      await call(`/products/${id}`, { method: 'PATCH', body: { categoryId: wantedCategory } });
    }

    // Four angles of the same subject, so the gallery has thumbnails to show.
    const media = [1, 2, 3].map((shot) => ({
      url: photo(product.keyword, 100 + index + shot * 1000),
      altText: `${product.name} — view ${shot + 1}`,
      sortOrder: shot * 10,
    }));
    await call(`/products/${id}/media`, { method: 'PUT', body: { media } });

    const specs = (
      product.specs ?? [
        `General|Brand|${product.brand ? BRANDS.find((b) => b.key === product.brand)?.name : 'ShopMart'}`,
        `General|Category|${CATEGORIES.find((c) => c.key === product.category)?.name}`,
        'General|Warranty|1 year',
        'Delivery|Dispatch|1–2 working days',
      ]
    ).map((row, position) => {
      const [groupName, label, value] = row.split('|');
      return {
        groupName: groupName ?? null,
        label: label ?? '',
        value: value ?? '',
        // The first row of the first group is what a comparison table shows.
        isKeySpec: position === 0,
        sortOrder: position * 10,
      };
    });
    await call(`/products/${id}/specifications`, { method: 'PUT', body: { specifications: specs } });

    // Without an explicit list, one colour picked deterministically — enough for
    // the swatch facet to be a real control rather than a single option.
    const wanted =
      product.attributes ??
      [`Colour:${['Black', 'White', 'Silver', 'Blue', 'Red', 'Green'][index % 6]}`];
    const ids = wanted
      .map((pair) => attributeValueIds.get(pair))
      .filter((value): value is string => Boolean(value));
    if (ids.length > 0) {
      await call(`/products/${id}/attributes`, { method: 'PUT', body: { attributeValueIds: ids } });
    }

    enriched += 1;
  }
  console.log(`  ok      ${enriched} products given a gallery, specifications and attributes`);

  // Bundles run after every product exists, since they point at other products.
  let bundled = 0;
  for (const [index, product] of PRODUCTS.entries()) {
    if (!product.bundle) continue;
    const id = productIds.get(`SM-${String(index + 1).padStart(3, '0')}`);
    if (!id) continue;

    const relatedProductIds = product.bundle
      .map((name) => {
        const position = PRODUCTS.findIndex((candidate) => candidate.name === name);
        return position === -1 ? undefined : productIds.get(`SM-${String(position + 1).padStart(3, '0')}`);
      })
      .filter((value): value is string => Boolean(value));

    if (relatedProductIds.length === 0) continue;
    const saved = await call(`/products/${id}/bundle`, { method: 'PUT', body: { relatedProductIds } });
    if (saved.status === 200) bundled += 1;
  }
  console.log(`  ok      ${bundled} products given a "frequently bought together" bundle`);

  // ---- variable products --------------------------------------------------
  console.log('\nVariants');
  for (const [index, product] of PRODUCTS.entries()) {
    if (!product.variants) continue;
    const sku = `SM-${String(index + 1).padStart(3, '0')}`;
    const id = productIds.get(sku);
    if (!id) continue;

    const payload = product.variants.map((variant, position) => {
      const ids = variant.options
        .map((pair) => attributeValueIds.get(pair))
        .filter((value): value is string => Boolean(value));

      return {
        // The first variant keeps the base SKU so the endpoint updates the
        // original row rather than replacing it — which is what preserves the
        // stock the opening adjustment put there.
        sku: variant.suffix ? `${sku}-${variant.suffix}` : sku,
        title: variant.options.map((pair) => pair.split(':')[1]).join(' / '),
        price: variant.price ?? product.price,
        salePrice: variant.salePrice ?? product.salePrice ?? null,
        costPrice: product.cost,
        imageUrl: photo(product.keyword, 100 + index),
        isDefault: position === 0,
        isActive: true,
        sortOrder: position * 10,
        attributeValueIds: ids,
      };
    });

    const saved = await call(`/products/${id}/variants`, { method: 'PUT', body: { variants: payload } });
    if (!report(`${product.name} — ${payload.length} variants`, saved.status, saved.body)) continue;

    // Stock each one to its target. Adjustments are deltas, so the current level
    // is read first and a re-run settles to the same numbers instead of stacking.
    const warehouses2 = await call('/warehouses');
    const warehouse = (warehouses2.body?.data ?? [])[0]?.id as string | undefined;
    for (const [position, variant] of product.variants.entries()) {
      const variantId = saved.body?.data?.variants?.find(
        (row: { sku: string }) => row.sku === payload[position]!.sku,
      )?.id as string | undefined;
      if (!variantId || !warehouse) continue;

      const levels = await call(`/inventory?variantId=${variantId}`);
      const level = ((levels.body?.data ?? []) as Array<{ variantId: string; available: number }>).find(
        (row) => row.variantId === variantId,
      );
      const delta = variant.stock - Number(level?.available ?? 0);

      const adjust = (amount: number, reason: string) =>
        call('/inventory/adjust', {
          method: 'POST',
          body: {
            variantId,
            warehouseId: warehouse,
            bucket: 'available',
            delta: amount,
            reason,
            lowStockThreshold: 5,
          },
        });

      /*
       * A sold-out variant is stocked and then emptied, rather than left alone.
       *
       * A variant nobody ever stocked has no `inventory_levels` row, and no row
       * means *not tracked*, which the storefront reads as available — so a
       * deliberately sold-out size showed as in stock. The row has to exist and
       * say zero. `adjust` refuses a delta of nothing (rightly: an adjustment of
       * zero is a mis-click), so one unit goes in and comes back out, which is
       * also the history a real sold-out variant has.
       */
      if (!level && variant.stock === 0) {
        await adjust(1, 'Opening stock (demo seed)');
        await adjust(-1, 'Sold out (demo seed)');
        continue;
      }

      if (delta === 0) continue;
      await adjust(delta, 'Opening stock (demo seed)');
    }
  }

  // ---- marketing ----------------------------------------------------------
  console.log('\nCoupons');
  for (const coupon of COUPONS) {
    await ensure('/coupons', 'code', coupon.code, coupon);
  }

  /*
   * Payment methods, so the footer badge row and the checkout have more than
   * one thing to show. `sslcommerz` is enabled without credentials on purpose:
   * it is an adapter seam, and what is being demonstrated is that the storefront
   * renders whatever the store has switched on rather than a fixed list.
   */
  console.log('\nPayment methods');
  for (const method of [
    { provider: 'cod', label: 'Cash on Delivery', description: 'Pay with cash when your order arrives.', sortOrder: 0 },
    { provider: 'mock', label: 'Card Payment', description: 'Pay securely by debit or credit card.', sortOrder: 10 },
    { provider: 'sslcommerz', label: 'SSLCommerz', description: 'Mobile banking, cards and net banking.', sortOrder: 20 },
  ]) {
    const saved = await call('/settings/payment-methods', {
      method: 'PUT',
      body: { ...method, instructions: null, isEnabled: true },
    });
    report(method.label, saved.status, saved.body);
  }

  /*
   * Banners, in the table the `/banners` admin screen writes.
   *
   * That screen has always written this table and nothing ever read it —
   * homepage banners lived in section config instead, so the manager edited rows
   * that reached no shopfront. `home.routes.ts` resolves them now, and a section
   * naming a `bannerPosition` picks them up.
   */
  console.log('\nBanners');
  for (const banner of BANNERS) {
    await ensure('/banners', 'title', banner.title, banner);
  }

  // ---- the homepage -------------------------------------------------------
  //
  // Rebuilt outright rather than edited: the six blocks provisioning seeds are a
  // starting point, and the arrangement below is a different one. Every product
  // block names a `source` instead of a list of ids, so the shop keeps filling
  // itself in as the owner adds stock.
  console.log('\nHomepage');
  const existingSections = await call('/website/homepage');
  for (const section of (existingSections.body?.data ?? []) as Array<{ id: string; type: string }>) {
    await call(`/website/homepage/${section.id}`, { method: 'DELETE' });
  }

  const circleOrder = ['electronics', 'fashion', 'home', 'beauty', 'sports', 'toys', 'automotive', 'tools']
    .map((key) => categoryIds.get(key))
    .filter((id): id is string => Boolean(id));

  /** Six departments as picture cards, a different selection from the circles. */
  const featuredCategoryIds = ['electronics', 'fashion', 'home', 'sports', 'beauty', 'garden']
    .map((key) => categoryIds.get(key))
    .filter((id): id is string => Boolean(id));

  /** One department's aisles — the subcategory block. */
  const electronicsChildIds = ['smartphones', 'laptops', 'audio', 'cameras', 'tv', 'printers']
    .map((key) => categoryIds.get(key))
    .filter((id): id is string => Boolean(id));

  const SECTIONS: Array<Record<string, unknown>> = [
    {
      type: 'hero',
      title: null,
      subtitle: null,
      sortOrder: 10,
      config: {
        slides: [
          {
            id: 'summer-sale',
            eyebrow: 'Summer Sale is Live!',
            heading: 'Upgrade Your Lifestyle Today',
            accentWord: 'Lifestyle',
            subheading: 'Discover top quality products at unbeatable prices. Shop the latest trends now.',
            imageUrl: wide('gadgets', 11),
            primaryCta: { label: 'Shop Now', href: '/shop' },
            secondaryCta: { label: 'View Deals', href: '/sale' },
            badge: { text: 'Up to 50% Off', tone: 'primary' },
            align: 'left',
            overlay: 'none',
          },
          {
            id: 'new-season',
            eyebrow: 'Fresh This Week',
            heading: 'New Arrivals Every Week',
            accentWord: 'New Arrivals',
            subheading: 'The latest in electronics, fashion and home — picked and priced to move.',
            imageUrl: wide('shopping', 12),
            primaryCta: { label: 'Shop New In', href: '/new-arrivals' },
            secondaryCta: { label: 'Browse All', href: '/shop' },
            badge: { text: 'Up to 30% Off', tone: 'primary' },
            align: 'left',
            overlay: 'none',
          },
        ],
      },
    },
    {
      type: 'category_circle',
      title: null,
      subtitle: null,
      sortOrder: 20,
      // Eight named, seven drawn — the eighth is what turns the last tile into
      // "More" rather than leaving the rail looking complete when it is not.
      config: { categoryIds: circleOrder, limit: 7 },
    },
    {
      type: 'benefits',
      title: null,
      subtitle: null,
      sortOrder: 30,
      config: {
        items: [
          { icon: 'truck', title: 'Free Shipping', description: 'On orders over $100' },
          { icon: 'refresh', title: 'Easy Returns', description: '30 days return policy' },
          { icon: 'shield', title: 'Secure Payment', description: '100% secure checkout' },
          { icon: 'support', title: '24/7 Support', description: "We're here to help" },
        ],
      },
    },
    {
      type: 'flash_sale',
      title: 'Weekend Flash Sale',
      subtitle: 'Three days only — while stock lasts',
      sortOrder: 35,
      // No ids and no deadline: both come from the live `flash_sales` row, so
      // the block disappears with the campaign rather than outliving it.
      config: { limit: 12 },
    },
    {
      type: 'deal',
      title: 'Deal of the Day',
      subtitle: null,
      sortOrder: 40,
      config: {
        // No `productId`: `sale` resolves to the deepest discount currently live,
        // so the block follows the campaign instead of pinning one product for ever.
        source: 'sale',
        banners: [
          {
            id: 'new-arrivals',
            title: 'New Arrivals',
            subtitle: 'Check out the latest products',
            buttonLabel: 'Shop Now',
            linkUrl: '/new-arrivals',
            imageUrl: photo('smartwatch', 21, 500),
            tone: 'sky',
          },
          {
            id: 'best-selling',
            title: 'Best Selling',
            subtitle: 'Top picks of the week',
            buttonLabel: 'Shop Now',
            linkUrl: '/best-sellers',
            imageUrl: photo('backpack', 22, 500),
            tone: 'sand',
          },
          {
            id: 'summer-sale',
            title: 'Summer Sale',
            subtitle: 'Up to 50% off on selected items',
            buttonLabel: 'Shop Now',
            linkUrl: '/sale',
            imageUrl: wide('summer shopping', 23),
            tone: 'mint',
          },
        ],
      },
    },
    {
      type: 'product_carousel',
      title: 'Featured Products',
      subtitle: null,
      sortOrder: 50,
      // Four questions about the catalogue, each answered server-side.
      config: {
        limit: 12,
        tabs: [
          { key: 'featured', label: 'Featured Products', source: 'featured' },
          { key: 'new', label: 'New Arrivals', source: 'new_arrivals' },
          { key: 'best', label: 'Best Sellers', source: 'best_selling' },
          { key: 'sale', label: 'On Sale', source: 'sale' },
        ],
      },
    },
    {
      type: 'banner',
      title: null,
      subtitle: null,
      sortOrder: 55,
      // Resolved from the `banners` table by placement rather than embedded, so
      // the `/banners` admin screen is what edits this strip.
      config: { bannerPosition: 'home_hero' },
    },
    {
      type: 'category_grid',
      title: 'Featured Categories',
      subtitle: 'Browse the departments our customers shop most',
      sortOrder: 60,
      config: { categoryIds: featuredCategoryIds, limit: 6 },
    },
    {
      type: 'collection',
      title: null,
      subtitle: null,
      sortOrder: 65,
      config: {
        collectionSlug: 'work-from-home',
        href: '/shop',
        ctaLabel: 'Shop the collection',
        limit: 8,
      },
    },
    {
      type: 'promo_trio',
      title: null,
      subtitle: null,
      sortOrder: 70,
      config: { bannerPosition: 'home_promo' },
    },
    {
      type: 'product_grid',
      title: 'Recommended For You',
      subtitle: 'Highest rated across the catalogue',
      sortOrder: 75,
      // `recommended` ranks by rating with a review-count floor, so a lone
      // five-star cannot outrank a 4.8 with two hundred behind it.
      config: { source: 'recommended', limit: 12 },
    },
    {
      type: 'category_grid',
      title: 'Shop Electronics',
      subtitle: 'Every aisle in the department',
      sortOrder: 80,
      // Subcategories, which is the same block pointed one level down — the
      // reason `category_grid` takes ids rather than a depth.
      config: { categoryIds: electronicsChildIds, limit: 6 },
    },
    {
      type: 'collection',
      title: null,
      subtitle: null,
      sortOrder: 85,
      config: {
        collectionSlug: 'gifts-under-100',
        href: '/shop?maxPrice=100',
        ctaLabel: 'Browse gifts',
        limit: 8,
      },
    },
    {
      type: 'lookbook',
      title: 'The Everyday Edit',
      subtitle: 'Four ways our customers put it together',
      sortOrder: 90,
      config: {
        ctaLabel: 'Shop the edit',
        ctaHref: '/shop',
        tiles: [
          { id: 'edit-desk', imageUrl: photo('modern desk setup', 51, 800), caption: 'The desk', linkUrl: '/category/electronics' },
          { id: 'edit-kitchen', imageUrl: photo('kitchen counter', 52, 800), caption: 'The kitchen', linkUrl: '/category/home-kitchen' },
          { id: 'edit-weekend', imageUrl: photo('weekend outfit', 53, 800), caption: 'The weekend', linkUrl: '/category/fashion' },
          { id: 'edit-outdoors', imageUrl: photo('hiking outdoors', 54, 800), caption: 'The outdoors', linkUrl: '/category/sports-outdoors' },
        ],
      },
    },
    {
      type: 'brands',
      title: 'Top Brands',
      subtitle: null,
      sortOrder: 95,
      config: {},
    },
    {
      /*
       * Written as section config rather than pulled from `reviews`, and the
       * distinction matters: a product review rates one product, whereas these
       * are about the shop. There is no table for them, so a store that has not
       * written any gets no section — which is why the block is config-driven
       * and not derived from the ten thousand ratings sitting next door.
       */
      type: 'testimonial',
      title: 'What our customers say',
      subtitle: null,
      sortOrder: 100,
      config: {
        items: [
          {
            id: 'testimonial-1',
            quote:
              'Ordered on a Thursday evening and it was on my doorstep Saturday morning. The packaging was better than the high-street shop I usually buy from.',
            authorName: 'Priya Raman',
            authorTitle: 'Verified buyer',
            rating: 5,
          },
          {
            id: 'testimonial-2',
            quote:
              'I had to return a pair of trainers for a size up. The whole thing took four minutes and nobody asked me to justify it.',
            authorName: 'Daniel Okafor',
            authorTitle: 'Verified buyer',
            rating: 5,
          },
          {
            id: 'testimonial-3',
            quote:
              'Prices are genuinely competitive and the product photos match what turns up. That sounds like a low bar and it is one a lot of shops miss.',
            authorName: 'Marta Kowalski',
            authorTitle: 'Verified buyer',
            rating: 4,
          },
        ],
      },
    },
    {
      type: 'social_gallery',
      title: 'Shop our Instagram',
      subtitle: null,
      sortOrder: 105,
      config: {
        handle: '@shopmart',
        tiles: [
          { id: 'ig-1', imageUrl: photo('flatlay gadgets', 61), caption: 'Desk goals', linkUrl: 'https://instagram.com/shopmart' },
          { id: 'ig-2', imageUrl: photo('coffee morning', 62), caption: 'Morning kit', linkUrl: 'https://instagram.com/shopmart' },
          { id: 'ig-3', imageUrl: photo('street style', 63), caption: 'Out and about', linkUrl: 'https://instagram.com/shopmart' },
          { id: 'ig-4', imageUrl: photo('home living room', 64), caption: 'Living room', linkUrl: 'https://instagram.com/shopmart' },
          { id: 'ig-5', imageUrl: photo('running shoes', 65), caption: 'Weekend miles', linkUrl: 'https://instagram.com/shopmart' },
          { id: 'ig-6', imageUrl: photo('camping tent', 66), caption: 'Off grid', linkUrl: 'https://instagram.com/shopmart' },
        ],
      },
    },
    {
      /*
       * Last before the newsletter, and empty for a first-time visitor — which
       * is correct rather than broken. The list lives in the browser, so this is
       * the one block whose contents the server never sees.
       */
      type: 'recently_viewed',
      title: 'Recently Viewed',
      subtitle: null,
      sortOrder: 110,
      config: {},
    },
    {
      type: 'newsletter',
      title: 'Subscribe to our Newsletter',
      subtitle: 'Get the latest updates on new products and upcoming sales',
      sortOrder: 115,
      config: {},
    },
  ];

  for (const section of SECTIONS) {
    const result = await call('/website/homepage', { method: 'POST', body: section });
    report(`section ${String(section.type)}`, result.status, result.body);
  }

  // ---- reviews and sold counts --------------------------------------------
  //
  // Straight to the tenant database: a review is something a customer writes, so
  // no admin endpoint creates one, and `sold_count` moves on dispatch and
  // nowhere else. Both are needed for a demo to show ratings and a credible
  // best-seller order, and neither is a thing the panel may invent.
  console.log('\nReviews and sales history');
  const pool = await openTenantPoolForSlug(SLUG!);

  let reviewRows = 0;
  try {
    for (const [index, product] of PRODUCTS.entries()) {
      const sku = `SM-${String(index + 1).padStart(3, '0')}`;
      const id = productIds.get(sku);
      if (!id) continue;

      if (product.sold) {
        await pool.query('update products set sold_count = $1 where id = $2', [product.sold, id]);
      }

      if (!product.reviews) continue;

      // Rewritten from scratch each run, so a second run does not stack a second
      // set of ratings on top of the first. Only the seeded ones: a review a real
      // customer left carries a `customer_id` and is left alone.
      await pool.query('delete from reviews where product_id = $1 and customer_id is null', [id]);

      const stars = distribution(product.reviews.count, product.reviews.average);

      // One statement per product rather than per review — 214 round trips for a
      // single product's ratings is a slow seed for no benefit.
      for (let start = 0; start < stars.length; start += 200) {
        const chunk = stars.slice(start, start + 200);
        const params: unknown[] = [];
        const tuples = chunk.map((rating, offset) => {
          const position = start + offset;
          const name = REVIEWERS[(index * 7 + position) % REVIEWERS.length]!;
          const body = reviewBody(rating, index + position);
          // Spread backwards from today so the whole set is not dated the same day.
          const daysAgo = Math.floor((position / Math.max(stars.length, 1)) * 240) + 1;

          params.push(id, name, rating, body, `${daysAgo} days`);
          const base = offset * 5;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'approved', true, now() - $${base + 5}::interval)`;
        });

        await pool.query(
          `insert into reviews (product_id, customer_name, rating, body, status, verified_purchase, created_at)
           values ${tuples.join(', ')}`,
          params,
        );
      }

      reviewRows += stars.length;

      // The same denormalisation the moderation endpoint performs on approval.
      await pool.query(
        `update products set
           rating_average = coalesce((select round(avg(rating)::numeric, 2) from reviews where product_id = $1 and status = 'approved'), 0),
           rating_count   = (select count(*) from reviews where product_id = $1 and status = 'approved')
         where id = $1`,
        [id],
      );
    }

    /*
     * Collections and the flash sale, also direct.
     *
     * Neither has an admin endpoint — the panel cannot create a collection or
     * schedule a campaign today, though both tables have been in the schema
     * since 0001. Until those screens exist this is the only way to put a row
     * in them, and the storefront reads them from the same tables it always
     * would, so nothing about the read path is special-cased for the demo.
     */
    console.log('\nCollections');
    const skuToProduct = new Map<string, { id: string; price: number }>();
    const priced = await pool.query<{ sku: string; id: string; price: string }>(
      `select v.sku, p.id, coalesce(p.sale_price_from, p.price_from) as price
         from products p join product_variants v on v.product_id = p.id and v.is_default`,
    );
    for (const row of priced.rows) skuToProduct.set(row.sku, { id: row.id, price: Number(row.price) });

    for (const collection of COLLECTIONS) {
      const chosen = collection.skus
        .map((sku) => ({ sku, product: skuToProduct.get(sku) }))
        .filter((entry): entry is { sku: string; product: { id: string; price: number } } =>
          Boolean(entry.product),
        )
        // A collection whose name makes a price claim has to keep it.
        .filter((entry) => !collection.maxPrice || entry.product.price < collection.maxPrice);

      if (chosen.length === 0) {
        console.log(`  skipped ${collection.name} — none of its products are in this catalogue`);
        continue;
      }

      const saved = await pool.query<{ id: string }>(
        `insert into collections (name, slug, description, image_url, is_active, sort_order)
         values ($1, $2, $3, $4, true, $5)
         on conflict (slug) do update set
           name = excluded.name, description = excluded.description,
           image_url = excluded.image_url, is_active = true, updated_at = now()
         returning id`,
        [
          collection.name,
          collection.slug,
          collection.description,
          wide(collection.keyword, collection.seed),
          COLLECTIONS.indexOf(collection) * 10,
        ],
      );

      const collectionId = saved.rows[0]!.id;
      // Rewritten rather than appended, so a re-run does not accumulate members.
      await pool.query('delete from collection_products where collection_id = $1', [collectionId]);
      for (const [position, entry] of chosen.entries()) {
        await pool.query(
          'insert into collection_products (collection_id, product_id, sort_order) values ($1, $2, $3)',
          [collectionId, entry.product.id, position * 10],
        );
      }

      const dropped = collection.skus.length - chosen.length;
      console.log(
        `  ok      ${collection.name} — ${chosen.length} products` +
          (dropped > 0 ? ` (${dropped} dropped: over the price the name promises)` : ''),
      );
    }

    console.log('\nFlash sale');
    // One live campaign at a time: the storefront takes the soonest-ending
    // active one, so leaving an older row active would make which sale runs a
    // matter of chance.
    await pool.query('update flash_sales set is_active = false where is_active = true');

    const campaign = await pool.query<{ id: string; ends_at: Date }>(
      `insert into flash_sales (name, starts_at, ends_at, is_active)
       values ($1, now(), now() + $2::interval, true)
       returning id, ends_at`,
      [FLASH_SALE.name, `${FLASH_SALE.hours} hours`],
    );

    const campaignId = campaign.rows[0]!.id;
    let flashItems = 0;
    for (const [position, item] of FLASH_SALE.items.entries()) {
      const product = skuToProduct.get(item.sku);
      if (!product) continue;
      // A "flash price" at or above what the product already costs is not one.
      if (Number(item.price) >= product.price) {
        console.log(`  skipped ${item.sku} — ${item.price} is not below its ${product.price}`);
        continue;
      }

      await pool.query(
        `insert into flash_sale_products (flash_sale_id, product_id, sale_price, sort_order)
         values ($1, $2, $3, $4)`,
        [campaignId, product.id, item.price, position * 10],
      );
      flashItems += 1;
    }
    console.log(
      `  ok      ${FLASH_SALE.name}: ${flashItems} products, ends ${campaign.rows[0]!.ends_at.toISOString()}`,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
  console.log(`  ok      ${reviewRows} approved reviews across the catalogue`);

  /*
   * Ratings went in behind the API's back, so the storefront's cached answers
   * still carry the old ones. `invalidateStorefrontOnWrite` is an `onResponse`
   * hook on writes, so re-saving the design — the same values, already accepted
   * once — is what drops the cache. A GET would not.
   */
  const bust = await call('/website/design', {
    method: 'PUT',
    body: (await call('/website/design')).body?.data,
  });
  if (bust.status !== 200) console.log('  (cache not dropped — it expires on its own within 5 minutes)');

  // ---- what the storefront will now show ----------------------------------
  console.log('\nWhat the shop has now');
  for (const [label, path] of [
    ['products', '/products?pageSize=1'],
    ['categories', '/categories?pageSize=1'],
    ['brands', '/brands?pageSize=1'],
    ['coupons', '/coupons?pageSize=1'],
    ['reviews', '/reviews?pageSize=1'],
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
