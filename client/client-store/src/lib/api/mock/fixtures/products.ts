import type { ProductSummary } from '@/types';
import { pooledImage } from './images';
import { rngFor } from './random';
import { BRAND_BY_ID, MOCK_BRANDS } from './brands';

/**
 * The catalogue.
 *
 * Two halves, on purpose:
 *
 * - **Hero seeds** are written by hand. They are the products the homepage
 *   sections name explicitly, so they carry real names, real specifications and
 *   prices that make the reference layouts look right — the watch, the
 *   headphones, the dress.
 * - **The rest are generated** from a per-category vocabulary crossed with a
 *   seeded generator. That is ~130 lines instead of ~1,700 literal objects, and
 *   because the seed is the slug the numbers never change between renders.
 *
 * The volume matters: a six-across rail with four tabs, plus related products,
 * plus eight categories that each need enough for a second page of listing,
 * cannot be fed by two dozen products.
 */

interface Seed {
  name: string;
  slug: string;
  brand: string;
  category: string;
  price: string;
  salePrice?: string;
  rating: number;
  ratingCount: number;
  keySpec?: string;
  inStock?: boolean;
  lowStock?: boolean;
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  variants?: boolean;
}

const HERO_SEEDS: Seed[] = [
  { name: 'Floral Summer Dress', slug: 'floral-summer-dress', brand: 'br-mango', category: 'cat-dresses', price: '49.99', salePrice: '39.99', rating: 4.5, ratingCount: 128, isBestSeller: true, variants: true },
  { name: 'Floral Print Maxi Dress', slug: 'floral-print-maxi-dress', brand: 'br-mango', category: 'cat-dresses', price: '49.99', salePrice: '39.99', rating: 4.5, ratingCount: 128, isNewArrival: true, variants: true },
  { name: 'Men Regular Fit Shirt', slug: 'men-regular-fit-shirt', brand: 'br-zara', category: 'cat-shirts', price: '29.99', rating: 4.4, ratingCount: 96, variants: true },
  { name: "Men's Casual Linen Shirt", slug: 'mens-casual-linen-shirt', brand: 'br-zara', category: 'cat-shirts', price: '39.99', salePrice: '29.99', rating: 4.4, ratingCount: 96, variants: true, isBestSeller: true },
  { name: 'Classic Leather Watch', slug: 'classic-leather-watch', brand: 'br-guess', category: 'cat-watches', price: '99.00', salePrice: '84.99', rating: 4.6, ratingCount: 215, keySpec: 'Sapphire glass · 5 ATM · Leather strap', isBestSeller: true },
  { name: 'Minimal Leather Watch', slug: 'minimal-leather-watch', brand: 'br-guess', category: 'cat-watches', price: '99.99', salePrice: '84.99', rating: 4.6, ratingCount: 215, keySpec: 'Sapphire glass · 3 ATM' },
  { name: 'Designer Handbag', slug: 'designer-handbag', brand: 'br-mango', category: 'cat-bags', price: '59.99', rating: 4.8, ratingCount: 76, isNewArrival: true },
  { name: 'Classic Handbag', slug: 'classic-handbag', brand: 'br-guess', category: 'cat-bags', price: '59.99', rating: 4.8, ratingCount: 76 },
  { name: 'Running Sneakers', slug: 'running-sneakers', brand: 'br-nike', category: 'cat-footwear', price: '99.99', salePrice: '89.99', rating: 4.5, ratingCount: 142, variants: true, lowStock: true },
  { name: 'Polarized Sunglasses', slug: 'polarized-sunglasses', brand: 'br-hm', category: 'cat-eyewear', price: '19.99', rating: 4.3, ratingCount: 88 },
  { name: 'Sony WH-1000XM5 Wireless Headphones', slug: 'sony-wh-1000xm5-wireless-headphones', brand: 'br-sony', category: 'cat-audio', price: '399.00', salePrice: '299.00', rating: 4.7, ratingCount: 312, keySpec: '30h battery · Adaptive ANC · Bluetooth 5.3', isBestSeller: true },
  { name: 'Portable Bluetooth Speaker', slug: 'portable-bluetooth-speaker', brand: 'br-sony', category: 'cat-audio', price: '129.00', salePrice: '99.00', rating: 4.6, ratingCount: 198, keySpec: 'IP67 · 20h playtime · USB-C', isBestSeller: true },
  { name: 'Smart Fitness Watch', slug: 'smart-fitness-watch', brand: 'br-samsung', category: 'cat-wearables', price: '199.00', rating: 4.4, ratingCount: 276, keySpec: 'GPS · 7-day battery · AMOLED', inStock: false },
  { name: 'Oversized Wool Coat', slug: 'oversized-wool-coat', brand: 'br-zara', category: 'cat-outerwear', price: '159.00', rating: 4.6, ratingCount: 54, isNewArrival: true, variants: true },
  { name: 'Structured Blazer', slug: 'structured-blazer', brand: 'br-zara', category: 'cat-outerwear', price: '119.00', salePrice: '89.00', rating: 4.7, ratingCount: 41, variants: true, isNewArrival: true },
  { name: 'Linen Blend Trousers', slug: 'linen-blend-trousers', brand: 'br-hm', category: 'cat-trousers', price: '44.99', salePrice: '34.99', rating: 4.2, ratingCount: 61, variants: true },
  { name: 'Slim Fit Denim Jeans', slug: 'slim-fit-denim-jeans', brand: 'br-levis', category: 'cat-trousers', price: '89.00', salePrice: '69.00', rating: 4.5, ratingCount: 231, variants: true, isBestSeller: true },
  { name: 'Ribbed Knit Top', slug: 'ribbed-knit-top', brand: 'br-mango', category: 'cat-tops', price: '24.99', rating: 4.4, ratingCount: 73, variants: true },
  { name: 'Cotton Crew T-Shirt', slug: 'cotton-crew-t-shirt', brand: 'br-hm', category: 'cat-tops', price: '14.99', rating: 4.0, ratingCount: 189, variants: true, isBestSeller: true },
  { name: 'Canvas Low-Top Trainers', slug: 'canvas-low-top-trainers', brand: 'br-adidas', category: 'cat-footwear', price: '64.99', rating: 4.1, ratingCount: 102, variants: true },
  { name: 'Leather Crossbody Bag', slug: 'leather-crossbody-bag', brand: 'br-zara', category: 'cat-bags', price: '79.00', rating: 4.7, ratingCount: 44, isNewArrival: true },
  { name: 'Performance Training Shorts', slug: 'performance-training-shorts', brand: 'br-puma', category: 'cat-trousers', price: '34.99', rating: 4.3, ratingCount: 67, variants: true },
  { name: 'Silk Scarf', slug: 'silk-scarf', brand: 'br-mango', category: 'cat-accessories', price: '29.99', rating: 4.6, ratingCount: 38 },
  { name: 'Woven Straw Hat', slug: 'woven-straw-hat', brand: 'br-mango', category: 'cat-accessories', price: '24.00', rating: 4.5, ratingCount: 66, isNewArrival: true },
  { name: 'Hydrating Face Serum', slug: 'hydrating-face-serum', brand: 'br-philips', category: 'cat-beauty', price: '26.50', rating: 4.4, ratingCount: 155, keySpec: '30ml · Hyaluronic acid' },
  { name: 'Ceramic Table Lamp', slug: 'ceramic-table-lamp', brand: 'br-ikea', category: 'cat-home', price: '54.00', rating: 4.5, ratingCount: 29, isNewArrival: true },
  { name: 'Kids Cotton Hoodie', slug: 'kids-cotton-hoodie', brand: 'br-hm', category: 'cat-kids', price: '22.99', salePrice: '17.99', rating: 4.2, ratingCount: 84, variants: true },
  { name: 'Pleated Midi Skirt', slug: 'pleated-midi-skirt', brand: 'br-mango', category: 'cat-dresses', price: '39.99', rating: 4.3, ratingCount: 52, variants: true },
];

// --------------------------------------------------------------- generated ---

interface Vocabulary {
  category: string;
  brands: string[];
  adjectives: string[];
  nouns: string[];
  priceRange: [number, number];
  variants: boolean;
  specs?: string[];
  count: number;
}

const VOCABULARY: Vocabulary[] = [
  { category: 'cat-dresses', brands: ['br-mango', 'br-zara', 'br-hm', 'br-guess'], adjectives: ['Wrap', 'Tiered', 'Satin', 'Poplin', 'Shirred', 'Asymmetric', 'Belted', 'Smocked'], nouns: ['Midi Dress', 'Maxi Dress', 'Slip Dress', 'Shirt Dress'], priceRange: [32, 129], variants: true, count: 9 },
  { category: 'cat-tops', brands: ['br-mango', 'br-hm', 'br-zara'], adjectives: ['Cropped', 'Boxy', 'Puff-Sleeve', 'Cable-Knit', 'Linen', 'Ruched', 'Sheer'], nouns: ['Blouse', 'Sweater', 'Cardigan', 'Camisole', 'Tank Top'], priceRange: [16, 79], variants: true, count: 10 },
  { category: 'cat-outerwear', brands: ['br-zara', 'br-hm', 'br-levis'], adjectives: ['Quilted', 'Cropped', 'Longline', 'Double-Breasted', 'Padded', 'Corduroy'], nouns: ['Jacket', 'Trench Coat', 'Puffer', 'Overshirt'], priceRange: [69, 249], variants: true, count: 8 },
  { category: 'cat-shirts', brands: ['br-zara', 'br-hm', 'br-levis', 'br-guess'], adjectives: ['Oxford', 'Flannel', 'Poplin', 'Slim-Fit', 'Relaxed', 'Striped', 'Chambray'], nouns: ['Shirt', 'Polo Shirt', 'Henley', 'Overshirt'], priceRange: [22, 89], variants: true, count: 11 },
  { category: 'cat-trousers', brands: ['br-levis', 'br-hm', 'br-puma', 'br-adidas'], adjectives: ['Tapered', 'Straight-Leg', 'Cargo', 'Pleated', 'Wide-Leg', 'Cropped'], nouns: ['Chinos', 'Jeans', 'Joggers', 'Trousers'], priceRange: [28, 119], variants: true, count: 9 },
  { category: 'cat-footwear', brands: ['br-nike', 'br-adidas', 'br-puma', 'br-zara'], adjectives: ['Retro', 'Chunky', 'Suede', 'Knit', 'Leather', 'Court'], nouns: ['Sneakers', 'Trainers', 'Loafers', 'Ankle Boots', 'Sandals'], priceRange: [39, 179], variants: true, count: 10 },
  { category: 'cat-bags', brands: ['br-mango', 'br-guess', 'br-zara'], adjectives: ['Structured', 'Quilted', 'Woven', 'Slouchy', 'Mini', 'Canvas'], nouns: ['Tote', 'Shoulder Bag', 'Backpack', 'Clutch', 'Bucket Bag'], priceRange: [29, 189], variants: false, count: 8 },
  { category: 'cat-watches', brands: ['br-guess', 'br-samsung', 'br-sony'], adjectives: ['Automatic', 'Chronograph', 'Skeleton', 'Field', 'Dive'], nouns: ['Watch'], priceRange: [69, 349], variants: false, specs: ['Sapphire glass · 10 ATM', 'Automatic movement · 42h reserve', 'Stainless steel · 5 ATM', 'Quartz · Date window'], count: 7 },
  { category: 'cat-eyewear', brands: ['br-hm', 'br-guess', 'br-zara'], adjectives: ['Aviator', 'Cat-Eye', 'Round', 'Oversized', 'Rimless', 'Square'], nouns: ['Sunglasses', 'Optical Frames'], priceRange: [15, 129], variants: false, specs: ['UV400 · Polarised', 'UV400 · Acetate frame'], count: 7 },
  { category: 'cat-audio', brands: ['br-sony', 'br-samsung', 'br-philips'], adjectives: ['Wireless', 'Noise-Cancelling', 'Open-Ear', 'Studio', 'Compact'], nouns: ['Earbuds', 'Headphones', 'Speaker', 'Soundbar'], priceRange: [29, 449], variants: false, specs: ['ANC · 24h battery · USB-C', 'Bluetooth 5.3 · IPX4', '40mm drivers · Hi-Res Audio', '360 sound · 12h playtime'], count: 8 },
  { category: 'cat-wearables', brands: ['br-samsung', 'br-sony', 'br-philips'], adjectives: ['Smart', 'Sport', 'Classic', 'Active'], nouns: ['Fitness Band', 'Smart Watch', 'Sleep Tracker', 'Smart Ring'], priceRange: [39, 399], variants: false, specs: ['GPS · 14-day battery', 'AMOLED · SpO2 · 5 ATM', 'Heart-rate · Sleep staging'], count: 8 },
  { category: 'cat-beauty', brands: ['br-philips', 'br-hm'], adjectives: ['Nourishing', 'Brightening', 'Gentle', 'Repairing', 'Daily'], nouns: ['Cleanser', 'Moisturiser', 'Serum', 'Hair Oil', 'Sunscreen'], priceRange: [9, 89], variants: false, specs: ['50ml', '100ml · Fragrance-free', '30ml · SPF 50'], count: 10 },
  { category: 'cat-home', brands: ['br-ikea', 'br-philips'], adjectives: ['Woven', 'Stoneware', 'Rattan', 'Linen', 'Brushed Brass', 'Recycled Glass'], nouns: ['Cushion Cover', 'Vase', 'Throw', 'Floor Lamp', 'Serving Bowl', 'Storage Basket'], priceRange: [12, 199], variants: false, count: 12 },
  { category: 'cat-kids', brands: ['br-hm', 'br-zara', 'br-adidas'], adjectives: ['Printed', 'Ribbed', 'Fleece', 'Organic Cotton'], nouns: ['T-Shirt', 'Joggers', 'Dungarees', 'Sweatshirt'], priceRange: [8, 49], variants: true, count: 10 },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Expands the vocabulary tables into products.
 *
 * Adjective × noun pairs are drawn without repetition within a category, so a
 * listing never shows the same name twice.
 */
function generate(): Seed[] {
  const seeds: Seed[] = [];
  const usedSlugs = new Set(HERO_SEEDS.map((seed) => seed.slug));

  for (const vocabulary of VOCABULARY) {
    const combinations: { adjective: string; noun: string }[] = [];
    for (const adjective of vocabulary.adjectives) {
      for (const noun of vocabulary.nouns) combinations.push({ adjective, noun });
    }

    const rng = rngFor(`vocab:${vocabulary.category}`);
    const chosen = rng.sample(combinations, vocabulary.count);

    for (const { adjective, noun } of chosen) {
      const name = `${adjective} ${noun}`;
      const slug = slugify(name);
      if (usedSlugs.has(slug)) continue;
      usedSlugs.add(slug);

      // Seeded per product, so its numbers are stable and independent of
      // whatever was generated before it.
      const product = rngFor(`product:${slug}`);
      const [low, high] = vocabulary.priceRange;
      const price = product.int(low, high) - 0.01;
      const onSale = product.chance(0.35);
      const salePrice = onSale ? Math.max(1, Math.round(price * product.float(0.6, 0.88))) - 0.01 : undefined;

      seeds.push({
        name,
        slug,
        brand: product.pick(vocabulary.brands),
        category: vocabulary.category,
        price: price.toFixed(2),
        salePrice: salePrice?.toFixed(2),
        rating: Number(product.float(3.6, 5).toFixed(1)),
        ratingCount: product.int(6, 340),
        keySpec: vocabulary.specs ? product.pick(vocabulary.specs) : undefined,
        inStock: !product.chance(0.06),
        lowStock: product.chance(0.14),
        isNewArrival: product.chance(0.22),
        isBestSeller: product.chance(0.16),
        variants: vocabulary.variants,
      });
    }
  }

  return seeds;
}

function toProduct(seed: Seed): ProductSummary {
  const brand = BRAND_BY_ID.get(seed.brand) ?? null;
  const full = Number.parseFloat(seed.price);
  const sale = seed.salePrice ? Number.parseFloat(seed.salePrice) : null;

  return {
    id: `prod-${seed.slug}`,
    slug: seed.slug,
    name: seed.name,
    brand: brand ? { id: brand.id, name: brand.name, slug: brand.slug } : null,
    primaryImage: {
      url: pooledImage(seed.slug, 800, 800),
      altText: seed.name,
      width: 800,
      height: 800,
    },
    secondaryImage: {
      // A different pool entry, so the hover swap is visibly a second image.
      url: pooledImage(seed.slug, 800, 800, 7),
      altText: `${seed.name}, alternate view`,
      width: 800,
      height: 800,
    },
    price: seed.price,
    salePrice: seed.salePrice ?? null,
    // Computed from the two prices it is shown beside, so a badge can never
    // disagree with the numbers under it.
    discountPercent: sale && sale < full ? Math.round(((full - sale) / full) * 100) : null,
    currency: 'USD',
    ratingAverage: seed.rating,
    ratingCount: seed.ratingCount,
    inStock: seed.inStock ?? true,
    lowStock: (seed.inStock ?? true) && (seed.lowStock ?? false),
    isNewArrival: seed.isNewArrival ?? false,
    isBestSeller: seed.isBestSeller ?? false,
    keySpec: seed.keySpec ?? null,
    hasVariants: seed.variants ?? false,
  };
}

const ALL_SEEDS: Seed[] = [...HERO_SEEDS, ...generate()];

export const MOCK_PRODUCTS: ProductSummary[] = ALL_SEEDS.map(toProduct);

export const PRODUCT_BY_ID = new Map(MOCK_PRODUCTS.map((product) => [product.id, product]));
export const PRODUCT_BY_SLUG = new Map(MOCK_PRODUCTS.map((product) => [product.slug, product]));

/** Which category each product belongs to; the summary type does not carry it. */
export const CATEGORY_OF = new Map(ALL_SEEDS.map((seed) => [`prod-${seed.slug}`, seed.category]));

export function productsInCategory(categoryId: string): ProductSummary[] {
  return MOCK_PRODUCTS.filter((product) => CATEGORY_OF.get(product.id) === categoryId);
}

export function productsForBrand(brandId: string): ProductSummary[] {
  return MOCK_PRODUCTS.filter((product) => product.brand?.id === brandId);
}

/** Ids, for homepage sections that name their products explicitly. */
export function idsOf(slugs: string[]): string[] {
  return slugs.map((slug) => `prod-${slug}`).filter((id) => PRODUCT_BY_ID.has(id));
}

export function idsWhere(predicate: (product: ProductSummary) => boolean, limit = 12): string[] {
  return MOCK_PRODUCTS.filter(predicate).slice(0, limit).map((product) => product.id);
}

export { MOCK_BRANDS };
