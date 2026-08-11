import type { StoreConfig } from '@/types';
import { MOCK_CATEGORIES } from './categories';

/**
 * The store's published configuration.
 *
 * Mirrors what `loadStorefrontConfig()` on the Commerce API side assembles:
 * brand, design, announcement, navigation, category menu, policy pages, payment
 * providers, SEO and lifecycle status. Nothing here is invented that the real
 * contract does not carry.
 */
export const MOCK_STORE_CONFIG: StoreConfig = {
  store: {
    slug: 'abc-fashion',
    name: 'ABC Fashion',
    tagline: 'Premium fashion and lifestyle products you can trust.',
    currency: 'USD',
    language: 'en',
    timezone: 'Asia/Dhaka',
    logoUrl: null,
    faviconUrl: null,
    canonicalOrigin: 'http://localhost:3003',
    languages: ['en', 'bn'],
    currencies: ['USD', 'BDT'],
  },
  design: { templateKey: 'modern_shop', colorThemeKey: 'royal_blue' },
  announcement: {
    enabled: true,
    messages: [
      {
        id: 'a1',
        text: 'Mid-Season Sale is live — up to 50% off selected items',
        linkUrl: '/sale',
        linkLabel: 'Shop now',
      },
      {
        id: 'a2',
        text: 'Free shipping on orders over $100',
        linkUrl: '/page/shipping-policy',
        linkLabel: 'See details',
      },
      {
        id: 'a3',
        text: '30-day returns on everything, no questions asked',
        linkUrl: '/page/return-policy',
        linkLabel: 'Our policy',
      },
    ],
  },
  contact: {
    businessName: 'ABC Fashion Ltd.',
    email: 'hello@abcfashion.com',
    phone: '+880 1700 000000',
    address: '12 Gulshan Avenue, Dhaka 1212, Bangladesh',
    whatsappNumber: '+8801700000000',
    whatsappEnabled: true,
  },
  navigation: {
    header: [
      { id: 'n-home', label: 'Home', href: '/', opensInNewTab: false, children: [] },
      /*
       * No "Shop" entry. Both `/shop` and `/categories` are treated as the
       * catalogue by the mega menu, so the two sat side by side opening an
       * identical department dropdown — two buttons for one thing. Every
       * product is still one click away through Categories, and the footer
       * keeps a direct "All Products" link to `/shop` itself.
       */
      { id: 'n-categories', label: 'Categories', href: '/categories', opensInNewTab: false, children: [] },
      { id: 'n-brands', label: 'Brands', href: '/brands', opensInNewTab: false, children: [] },
      { id: 'n-new', label: 'New Arrivals', href: '/new-arrivals', opensInNewTab: false, children: [] },
      { id: 'n-sale', label: 'Sale', href: '/sale', opensInNewTab: false, children: [] },
      { id: 'n-about', label: 'About Us', href: '/about', opensInNewTab: false, children: [] },
      { id: 'n-contact', label: 'Contact', href: '/contact', opensInNewTab: false, children: [] },
    ],
    footer: [
      { id: 'f-all', label: 'All Products', href: '/shop', opensInNewTab: false, children: [] },
      { id: 'f-new', label: 'New Arrivals', href: '/new-arrivals', opensInNewTab: false, children: [] },
      { id: 'f-best', label: 'Best Sellers', href: '/best-sellers', opensInNewTab: false, children: [] },
      { id: 'f-sale', label: 'On Sale', href: '/sale', opensInNewTab: false, children: [] },
      { id: 'f-featured', label: 'Featured', href: '/featured', opensInNewTab: false, children: [] },
    ],
  },
  categoryMenu: MOCK_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    iconUrl: null,
    children: category.children.map((child) => ({ id: child.id, name: child.name, slug: child.slug })),
  })),
  policyPages: [
    { slug: 'shipping-policy', title: 'Shipping Policy', systemKey: 'shipping_policy' },
    { slug: 'return-policy', title: 'Returns & Refunds', systemKey: 'return_policy' },
    { slug: 'refund-policy', title: 'Refund Policy', systemKey: 'refund_policy' },
    { slug: 'privacy', title: 'Privacy Policy', systemKey: 'privacy_policy' },
    { slug: 'terms', title: 'Terms & Conditions', systemKey: 'terms' },
  ],
  payment: {
    providers: [
      { provider: 'cod', label: 'Cash on Delivery', description: 'Pay when your order arrives.' },
      { provider: 'bkash', label: 'bKash', description: 'Pay from your bKash wallet.' },
      { provider: 'nagad', label: 'Nagad', description: 'Pay from your Nagad wallet.' },
      { provider: 'card', label: 'Card', description: 'Visa, Mastercard and American Express.' },
    ],
  },
  seo: {
    title: 'ABC Fashion — Premium fashion and lifestyle',
    description: 'Shop dresses, shirts, shoes, bags and accessories from the brands you love.',
    socialImageUrl: null,
  },
  status: 'active',
};
