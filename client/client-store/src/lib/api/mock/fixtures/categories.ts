import type { Category } from '@/types';
import { img } from './images';

/**
 * The category tree.
 *
 * Eight departments, twelve children. Broad enough that the marketplace
 * template's sidebar and the mega menu both have something real to render, and
 * that the "More categories" affordance actually appears.
 */

interface Leaf {
  id: string;
  name: string;
  slug: string;
  count: number;
}

function leaf({ id, name, slug, count }: Leaf): Category {
  return {
    id,
    name,
    slug,
    description: null,
    imageUrl: img(slug, 600, 600),
    bannerUrl: null,
    productCount: count,
    children: [],
    breadcrumb: [],
    seo: { title: null, description: null },
  };
}

export const MOCK_CATEGORIES: Category[] = [
  {
    id: 'cat-women',
    name: "Women's Fashion",
    slug: 'womens-fashion',
    description: 'Dresses, tops, outerwear and everyday essentials, chosen by hand.',
    imageUrl: img('women', 600, 600),
    bannerUrl: img('women-banner', 1600, 500),
    productCount: 34,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [
      leaf({ id: 'cat-dresses', name: 'Dresses', slug: 'dresses', count: 12 }),
      leaf({ id: 'cat-tops', name: 'Tops', slug: 'tops', count: 12 }),
      leaf({ id: 'cat-outerwear', name: 'Outerwear', slug: 'outerwear', count: 10 }),
    ],
  },
  {
    id: 'cat-men',
    name: "Men's Fashion",
    slug: 'mens-fashion',
    description: 'Shirts, trousers and tailoring built to last more than a season.',
    imageUrl: img('men', 600, 600),
    bannerUrl: img('men-banner', 1600, 500),
    productCount: 26,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [
      leaf({ id: 'cat-shirts', name: 'Shirts', slug: 'shirts', count: 14 }),
      leaf({ id: 'cat-trousers', name: 'Trousers', slug: 'trousers', count: 12 }),
    ],
  },
  {
    id: 'cat-shoes',
    name: 'Shoes & Bags',
    slug: 'shoes-bags',
    description: 'Footwear and carry, from everyday trainers to evening bags.',
    imageUrl: img('shoes', 600, 600),
    bannerUrl: img('shoes-banner', 1600, 500),
    productCount: 22,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [
      leaf({ id: 'cat-footwear', name: 'Footwear', slug: 'footwear', count: 12 }),
      leaf({ id: 'cat-bags', name: 'Bags', slug: 'bags', count: 10 }),
    ],
  },
  {
    id: 'cat-accessories',
    name: 'Accessories',
    slug: 'accessories',
    description: 'Watches, eyewear, scarves and the small things that finish an outfit.',
    imageUrl: img('accessories', 600, 600),
    bannerUrl: null,
    productCount: 18,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [
      leaf({ id: 'cat-watches', name: 'Watches', slug: 'watches', count: 9 }),
      leaf({ id: 'cat-eyewear', name: 'Eyewear', slug: 'eyewear', count: 9 }),
    ],
  },
  {
    id: 'cat-electronics',
    name: 'Electronics',
    slug: 'electronics',
    description: 'Audio, wearables and everyday tech, with the specifications that matter.',
    imageUrl: img('electronics', 600, 600),
    bannerUrl: img('electronics-banner', 1600, 500),
    productCount: 20,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [
      leaf({ id: 'cat-audio', name: 'Audio', slug: 'audio', count: 10 }),
      leaf({ id: 'cat-wearables', name: 'Wearables', slug: 'wearables', count: 10 }),
    ],
  },
  {
    id: 'cat-beauty',
    name: 'Beauty & Care',
    slug: 'beauty-care',
    description: 'Skincare, hair and fragrance.',
    imageUrl: img('beauty', 600, 600),
    bannerUrl: null,
    productCount: 12,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [],
  },
  {
    id: 'cat-home',
    name: 'Home & Living',
    slug: 'home-living',
    description: 'Lighting, textiles and objects for the rooms you actually use.',
    imageUrl: img('home', 600, 600),
    bannerUrl: img('home-banner', 1600, 500),
    productCount: 14,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [],
  },
  {
    id: 'cat-kids',
    name: 'Kids & Baby',
    slug: 'kids-baby',
    description: 'Clothing built for growing out of, not wearing out.',
    imageUrl: img('kids', 600, 600),
    bannerUrl: null,
    productCount: 12,
    breadcrumb: [],
    seo: { title: null, description: null },
    children: [],
  },
];

/** Flattened, for lookups by slug or id without walking the tree every time. */
export const ALL_CATEGORIES: Category[] = MOCK_CATEGORIES.flatMap((category) => [
  category,
  ...category.children,
]);

export const CATEGORY_BY_ID = new Map(ALL_CATEGORIES.map((category) => [category.id, category]));
export const CATEGORY_BY_SLUG = new Map(ALL_CATEGORIES.map((category) => [category.slug, category]));

/** Parent id for a child category, so a listing can widen its own breadcrumb. */
export const PARENT_OF = new Map<string, Category>(
  MOCK_CATEGORIES.flatMap((parent) => parent.children.map((child) => [child.id, parent] as const)),
);
