import type { ProductDetail, ProductSummary, Review, ReviewSummary, VariantOption, ProductVariant } from '@/types';
import { pooledImage } from './images';
import { rngFor } from './random';
import { CATEGORY_BY_ID, PARENT_OF } from './categories';
import { CATEGORY_OF, PRODUCT_BY_SLUG } from './products';

/**
 * Product detail, variants and reviews, derived from the catalogue.
 *
 * Generated rather than written out: 153 products each needing a gallery, an
 * option matrix, a specification table and a dozen reviews is far past what is
 * worth maintaining by hand, and every number here is a placeholder anyway.
 *
 * Everything is seeded from the product slug, so a product's variants, stock
 * and reviews are identical on every render. A listing that says "4.6 (215)"
 * and a detail page that says "4.2 (88)" for the same product would look like a
 * data bug rather than a fixture.
 */

const COLOURS: { value: string; slug: string; hex: string }[] = [
  { value: 'Black', slug: 'black', hex: '#18181B' },
  { value: 'White', slug: 'white', hex: '#FAFAFA' },
  { value: 'Navy', slug: 'navy', hex: '#1E3A5F' },
  { value: 'Olive', slug: 'olive', hex: '#5A6650' },
  { value: 'Sand', slug: 'sand', hex: '#D8C3A5' },
  { value: 'Burgundy', slug: 'burgundy', hex: '#6D2233' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

const SPEC_GROUPS: Record<string, [string, string][]> = {
  'cat-audio': [
    ['Driver size', '40 mm'],
    ['Battery life', '30 hours'],
    ['Charging', 'USB-C, 10 min for 5 hours'],
    ['Connectivity', 'Bluetooth 5.3, multipoint'],
    ['Weight', '254 g'],
  ],
  'cat-wearables': [
    ['Display', '1.4" AMOLED'],
    ['Battery life', 'Up to 14 days'],
    ['Water resistance', '5 ATM'],
    ['Sensors', 'Heart rate, SpO2, GPS'],
  ],
  'cat-watches': [
    ['Case', 'Stainless steel, 40 mm'],
    ['Glass', 'Sapphire crystal'],
    ['Movement', 'Quartz'],
    ['Water resistance', '5 ATM'],
    ['Strap', 'Genuine leather'],
  ],
  default: [
    ['Material', 'Cotton blend'],
    ['Fit', 'Regular'],
    ['Care', 'Machine wash cold, do not tumble dry'],
    ['Origin', 'Ethically made in Bangladesh'],
  ],
};

const REVIEW_PHRASES = {
  5: [
    'Exactly as described and the quality is better than I expected for the price.',
    'Arrived two days early. Fits perfectly and the material feels substantial.',
    'Second one I have bought. The first has held up through a year of washing.',
    'Photographs on the site match what turned up, which is rarer than it should be.',
    'Packaging was neat, no plastic waste, and the item was flawless.',
  ],
  4: [
    'Very good overall. Runs slightly large so consider sizing down.',
    'Happy with it. Delivery took a day longer than estimated but no complaints.',
    'Great quality. The colour is a touch darker than the photographs suggest.',
    'Does the job well. Would have liked more colour options.',
  ],
  3: [
    'Fine for the price, but the stitching is not as neat as I hoped.',
    'It is okay. Comfortable, though the fabric is thinner than expected.',
    'Average. Nothing wrong with it, nothing remarkable either.',
  ],
  2: [
    'Sizing is well off. Had to return and exchange, which was at least painless.',
    'Quality does not match the photographs. Disappointed.',
  ],
  1: ['Arrived damaged. Support sorted a refund quickly, but a wasted week.'],
} as const;

const REVIEWER_NAMES = [
  'Nusrat J.', 'Arif H.', 'Tanvir A.', 'Sadia R.', 'Mahmud K.', 'Farhana I.',
  'Rashed M.', 'Ishrat N.', 'Sabbir R.', 'Nadia H.', 'Imran S.', 'Rumana A.',
  'Fahim T.', 'Lubna K.', 'Zahid I.', 'Mitu R.',
];

/** Deterministic ISO date, N days before a fixed reference point. */
const REFERENCE = Date.parse('2026-07-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(REFERENCE - days * 86_400_000).toISOString();

function optionsFor(product: ProductSummary, categoryId: string): VariantOption[] {
  if (!product.hasVariants) return [];

  const rng = rngFor(`options:${product.slug}`);
  const options: VariantOption[] = [];

  const colours = rng.sample(COLOURS, rng.int(2, 4));
  options.push({
    attributeId: 'attr-colour',
    attributeName: 'Colour',
    slug: 'colour',
    inputType: 'color',
    values: colours.map((colour) => ({
      id: `av-colour-${colour.slug}`,
      value: colour.value,
      slug: colour.slug,
      colorHex: colour.hex,
    })),
  });

  // Footwear and bags do not take clothing sizes.
  const sized = !['cat-bags', 'cat-watches', 'cat-eyewear', 'cat-audio', 'cat-wearables', 'cat-home', 'cat-beauty'].includes(categoryId);
  if (sized) {
    const sizes = categoryId === 'cat-footwear' ? ['38', '39', '40', '41', '42', '43'] : SIZES;
    options.push({
      attributeId: 'attr-size',
      attributeName: 'Size',
      slug: 'size',
      inputType: 'select',
      values: sizes.map((size) => ({
        id: `av-size-${size.toLowerCase()}`,
        value: size,
        slug: size.toLowerCase(),
        colorHex: null,
      })),
    });
  }

  return options;
}

function variantsFor(product: ProductSummary, options: VariantOption[]): ProductVariant[] {
  if (options.length === 0) return [];

  const rng = rngFor(`variants:${product.slug}`);
  const combinations: Record<string, string>[] = [{}];

  for (const option of options) {
    const next: Record<string, string>[] = [];
    for (const partial of combinations) {
      for (const value of option.values) {
        next.push({ ...partial, [option.attributeId]: value.id });
      }
    }
    combinations.length = 0;
    combinations.push(...next);
  }

  return combinations.map((selection, index) => {
    // A real catalogue always has a few combinations that are sold out, and the
    // selector has to disable them — so the fixtures must contain some.
    const inStock = product.inStock && !rng.chance(0.18);
    const low = inStock && rng.chance(0.2);

    const title = options
      .map((option) => option.values.find((value) => value.id === selection[option.attributeId])?.value)
      .filter(Boolean)
      .join(' / ');

    return {
      id: `var-${product.slug}-${index}`,
      sku: `${product.slug.slice(0, 8).toUpperCase().replace(/-/g, '')}-${String(index + 1).padStart(3, '0')}`,
      title,
      price: product.price,
      salePrice: product.salePrice,
      discountPercent: product.discountPercent,
      inStock,
      lowStock: low,
      stockLabel: !inStock ? 'out_of_stock' : low ? 'low_stock' : 'in_stock',
      // A coarse band only — exact warehouse counts stay internal.
      remainingHint: low ? rng.int(2, 5) : null,
      imageUrl: null,
      selection,
    };
  });
}

function reviewsFor(product: ProductSummary): Review[] {
  if (product.ratingCount === 0) return [];

  const rng = rngFor(`reviews:${product.slug}`);
  const count = Math.min(product.ratingCount, rng.int(6, 14));

  return Array.from({ length: count }, (_, index) => {
    /*
     * Ratings are drawn around the product's own average, so the histogram on
     * the page agrees with the star rating above it. Reviews generated on a
     * flat distribution would show 4.6 stars over a pile of two-star text.
     */
    const drift = rng.float(-0.9, 0.9);
    const rating = Math.max(1, Math.min(5, Math.round(product.ratingAverage + drift))) as 1 | 2 | 3 | 4 | 5;
    const phrases = REVIEW_PHRASES[rating];

    return {
      id: `rev-${product.slug}-${index}`,
      customerName: rng.pick(REVIEWER_NAMES),
      rating,
      body: rng.pick(phrases),
      verifiedPurchase: rng.chance(0.8),
      createdAt: daysAgo(rng.int(2, 400)),
      images: [],
      adminReply:
        rating <= 2 && rng.chance(0.6)
          ? 'We are sorry this fell short. Our team has been in touch to put it right.'
          : null,
      adminRepliedAt: null,
    };
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * The rating histogram, over the product's **full** review count.
 *
 * Deliberately not tallied from the dozen reviews the fixture renders. The
 * summary says "128 reviews", and a histogram built from the nine on screen
 * would put 67% on five stars and 0% on everything below three — which reads as
 * a broken chart rather than as a sample.
 *
 * Instead the shape is derived from the average: weight each star band by how
 * close it is to the mean, then distribute the real total across those weights.
 * The result is consistent with the number beside it and with the stars above
 * it, which is the property that matters on a page a customer is reading.
 */
/**
 * Solves for the exponential weighting whose mean is `target`.
 *
 * `w(s) = e^(k·s)` over stars 1–5 is strictly increasing in `k`, so a bisection
 * finds the `k` that reproduces any average between 1 and 5. It also gives the
 * J-shape real review distributions have — a peak at the top with a thin tail —
 * rather than a symmetric bell nobody's ratings actually look like.
 */
function weightsForAverage(target: number): number[] {
  const stars = [1, 2, 3, 4, 5];
  const meanFor = (k: number) => {
    const weights = stars.map((star) => Math.exp(k * star));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.reduce((sum, weight, index) => sum + weight * stars[index]!, 0) / total;
  };

  let low = -8;
  let high = 8;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (meanFor(mid) < target) low = mid;
    else high = mid;
  }

  const k = (low + high) / 2;
  return stars.map((star) => Math.exp(k * star));
}

/**
 * The rating histogram, over the product's **full** review count.
 *
 * Deliberately not tallied from the dozen reviews the fixture renders. The
 * summary says "128 reviews", and a histogram built from the nine on screen
 * would put 67% on five stars and 0% on everything below three — which reads as
 * a broken chart rather than as a sample.
 *
 * The shape is instead solved so that **the histogram's own mean equals the
 * star rating printed above it**. Anyone who adds up the bars gets the number
 * they were shown; a chart that quietly disagrees with its own headline is the
 * thing this is avoiding.
 */
export function reviewSummaryOf(product: ProductSummary, reviews: Review[]): ReviewSummary {
  // The rendered reviews are a page of the total, not the basis of the summary.
  void reviews;

  const total = product.ratingCount;
  if (total === 0) {
    return { average: product.ratingAverage, count: 0, distribution: [0, 0, 0, 0, 0] };
  }

  const weights = weightsForAverage(product.ratingAverage);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  /*
   * Largest-remainder apportionment. Rounding each band independently loses or
   * gains reviews, and handing the difference to one band skews the mean —
   * this gives the leftovers to whichever bands were rounded down hardest, so
   * the counts sum to the total and stay closest to their exact shares.
   */
  const exact = weights.map((weight) => (weight / weightTotal) * total);
  const counts = exact.map((value) => Math.floor(value));

  let remainder = total - counts.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of order) {
    if (remainder <= 0) break;
    counts[index] = (counts[index] ?? 0) + 1;
    remainder -= 1;
  }

  return {
    average: product.ratingAverage,
    count: total,
    distribution: [counts[0]!, counts[1]!, counts[2]!, counts[3]!, counts[4]!],
  };
}

export function buildProductDetail(slug: string): ProductDetail | null {
  const product = PRODUCT_BY_SLUG.get(slug);
  if (!product) return null;

  const categoryId = CATEGORY_OF.get(product.id) ?? '';
  const category = CATEGORY_BY_ID.get(categoryId) ?? null;
  const parent = category ? PARENT_OF.get(category.id) : undefined;

  const rng = rngFor(`detail:${slug}`);
  const options = optionsFor(product, categoryId);
  const variants = variantsFor(product, options);
  const specs = SPEC_GROUPS[categoryId] ?? SPEC_GROUPS.default!;

  const images = Array.from({ length: 4 }, (_, index) => ({
    url: pooledImage(slug, 1000, 1000, index * 3),
    altText: `${product.name}, view ${index + 1}`,
    width: 1000,
    height: 1000,
  }));

  return {
    ...product,
    images,
    videoUrl: null,
    shortDescription: `${product.name}${product.brand ? ` by ${product.brand.name}` : ''} — ${
      product.keySpec ?? 'chosen by hand and photographed as it arrives'
    }.`,
    description: [
      `${product.name} is part of our ${category?.name ?? 'core'} range.`,
      'Every piece is checked before it is packed, photographed under consistent lighting, and listed with measurements taken from the item rather than copied from a supplier sheet.',
      'If it is not right, you have thirty days to send it back — unworn, tags on, no interrogation.',
    ].join('\n\n'),
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    breadcrumb: [
      ...(parent ? [{ name: parent.name, slug: parent.slug }] : []),
      ...(category ? [{ name: category.name, slug: category.slug }] : []),
    ],
    options,
    variants,
    defaultVariantId: variants.find((variant) => variant.inStock)?.id ?? variants[0]?.id ?? null,
    specifications: specs.map(([label, value], index) => ({
      groupName: 'Details',
      label,
      value,
      isKeySpec: index < 2,
    })),
    shippingInfo:
      'Dispatched within one working day. 1–2 days inside Dhaka, 2–5 days elsewhere. Free over $100.',
    returnInfo: 'Thirty-day returns on unworn items with tags attached.',
    isReturnable: !['cat-beauty'].includes(categoryId),
    minOrderQuantity: 1,
    maxOrderQuantity: rng.int(5, 10),
    seo: {
      title: `${product.name}${product.brand ? ` — ${product.brand.name}` : ''}`,
      description: product.keySpec ?? `Buy ${product.name} online.`,
    },
  };
}

export function buildReviews(slug: string): { reviews: Review[]; summary: ReviewSummary } | null {
  const product = PRODUCT_BY_SLUG.get(slug);
  if (!product) return null;

  const reviews = reviewsFor(product);
  return { reviews, summary: reviewSummaryOf(product, reviews) };
}
