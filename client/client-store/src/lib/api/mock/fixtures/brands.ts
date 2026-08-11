import type { Brand } from '@/types';

/**
 * Brands.
 *
 * `logoUrl` is deliberately null on all of them: it is the normal state for a
 * store that has not uploaded artwork yet, and it is the state the brand strip
 * and brand page need to handle gracefully. Every one of them falls back to a
 * wordmark, which is what the reference designs show anyway.
 */

interface Seed {
  id: string;
  name: string;
  slug: string;
  description: string;
  count: number;
}

const SEEDS: Seed[] = [
  { id: 'br-zara', name: 'Zara', slug: 'zara', description: 'Fast-moving contemporary fashion for women and men.', count: 16 },
  { id: 'br-hm', name: 'H&M', slug: 'hm', description: 'Everyday essentials at accessible prices.', count: 18 },
  { id: 'br-mango', name: 'Mango', slug: 'mango', description: 'Mediterranean-inflected womenswear and accessories.', count: 14 },
  { id: 'br-levis', name: "Levi's", slug: 'levis', description: 'Denim, since 1873.', count: 10 },
  { id: 'br-nike', name: 'Nike', slug: 'nike', description: 'Performance footwear and sportswear.', count: 12 },
  { id: 'br-adidas', name: 'Adidas', slug: 'adidas', description: 'Sport and street, three stripes.', count: 12 },
  { id: 'br-puma', name: 'Puma', slug: 'puma', description: 'Training, running and lifestyle.', count: 10 },
  { id: 'br-guess', name: 'Guess', slug: 'guess', description: 'Denim-led American fashion.', count: 8 },
  { id: 'br-sony', name: 'Sony', slug: 'sony', description: 'Audio, imaging and personal electronics.', count: 10 },
  { id: 'br-samsung', name: 'Samsung', slug: 'samsung', description: 'Displays, wearables and home technology.', count: 8 },
  { id: 'br-philips', name: 'Philips', slug: 'philips', description: 'Personal care and home appliances.', count: 8 },
  { id: 'br-ikea', name: 'Nordika', slug: 'nordika', description: 'Simple, functional pieces for the home.', count: 10 },
];

export const MOCK_BRANDS: Brand[] = SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  slug: seed.slug,
  description: seed.description,
  logoUrl: null,
  productCount: seed.count,
  seo: { title: null, description: null },
}));

export const BRAND_BY_ID = new Map(MOCK_BRANDS.map((brand) => [brand.id, brand]));
export const BRAND_BY_SLUG = new Map(MOCK_BRANDS.map((brand) => [brand.slug, brand]));
