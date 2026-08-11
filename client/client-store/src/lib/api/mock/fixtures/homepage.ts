import type { HomepageSection } from '@/types';
import { imgAvatar, imgHero, imgPortrait, imgSquare, imgWide } from './images';
import { MOCK_CATEGORIES } from './categories';
import { idsOf, idsWhere, MOCK_PRODUCTS } from './products';

/**
 * A published homepage.
 *
 * Section order and content is exactly what a store owner would have arranged
 * in the admin panel — this file is standing in for that table, not for a
 * hard-coded layout. Every template reads the same list and renders it in its
 * own shape, which is the property the whole design system rests on.
 *
 * Sections a template does not suit are dropped by that template rather than
 * being absent here: the minimal store hides the brand rail, the fashion
 * boutique moves the benefits strip into its header.
 */

const featuredIds = idsOf([
  'floral-print-maxi-dress',
  'mens-casual-linen-shirt',
  'minimal-leather-watch',
  'classic-handbag',
  'running-sneakers',
  'polarized-sunglasses',
  'oversized-wool-coat',
  'leather-crossbody-bag',
]);

export const MOCK_HOMEPAGE_SECTIONS: HomepageSection[] = [
  {
    id: 's-hero',
    type: 'hero',
    title: null,
    subtitle: null,
    config: {
      slides: [
        {
          id: 'h1',
          eyebrow: 'New Collection 2026',
          heading: 'Elevate Your Everyday Style',
          accentWord: 'Everyday Style',
          subheading: 'Discover the latest trends and timeless pieces, crafted for you.',
          imageUrl: imgHero('hero-style'),
          mobileImageUrl: imgPortrait('hero-style-m'),
          primaryCta: { label: 'Shop Now', href: '/shop' },
          secondaryCta: { label: 'Explore Collection', href: '/new-arrivals' },
          badge: { text: 'Up to 50% Off', tone: 'primary' },
          socialProof: {
            avatarUrls: [imgAvatar('face-1'), imgAvatar('face-2'), imgAvatar('face-3')],
            text: 'Trusted by 50,000+ happy customers',
          },
          align: 'left',
          overlay: 'none',
        },
        {
          id: 'h2',
          eyebrow: 'Summer Sale',
          heading: 'Find Your Style, Own Your Look',
          accentWord: 'Style',
          subheading: 'Explore the latest fashion trends and elevate your everyday look.',
          imageUrl: imgHero('hero-look'),
          mobileImageUrl: imgPortrait('hero-look-m'),
          primaryCta: { label: 'Shop Collection', href: '/shop' },
          secondaryCta: { label: 'Explore More', href: '/new-arrivals' },
          badge: { text: 'Up to 40% Off', tone: 'sale' },
          socialProof: null,
          align: 'left',
          overlay: 'none',
        },
        {
          id: 'h3',
          eyebrow: 'Upgrade Your Setup',
          heading: 'Upgrade Your Lifestyle Today',
          accentWord: 'Lifestyle',
          subheading: 'Top quality products at prices that make sense. Shop the latest trends.',
          imageUrl: imgHero('hero-tech'),
          mobileImageUrl: imgPortrait('hero-tech-m'),
          primaryCta: { label: 'Shop Now', href: '/category/electronics' },
          secondaryCta: { label: 'View Deals', href: '/sale' },
          badge: { text: 'Up to 50% Off', tone: 'accent' },
          socialProof: null,
          align: 'left',
          overlay: 'none',
        },
      ],
    },
  },

  {
    id: 's-categories',
    type: 'category_grid',
    /*
     * No heading. The category tiles are self-describing — each one carries its
     * own name — and all three reference designs run them straight under the
     * hero with nothing above them. A store owner who wants a heading can set
     * one; it is a field, not a fixture.
     */
    title: null,
    subtitle: null,
    /*
     * No `limit` either. How many tiles fit is a property of the presentation —
     * ten circles fill a row, six photo cards do — so each template's own
     * default is the right answer rather than one number that leaves orphans in
     * five of the six.
     */
    config: { categoryIds: MOCK_CATEGORIES.map((category) => category.id) },
  },

  {
    id: 's-benefits',
    type: 'benefits',
    title: null,
    subtitle: null,
    config: {
      items: [
        { icon: 'truck', title: 'Free Shipping', description: 'On orders over $100' },
        { icon: 'rotate-ccw', title: 'Easy Returns', description: '30 days return policy' },
        { icon: 'shield-check', title: 'Secure Payment', description: '100% secure checkout' },
        { icon: 'headphones', title: '24/7 Support', description: 'We are here to help' },
      ],
    },
  },

  {
    id: 's-deal',
    type: 'deal',
    title: 'Deal of the Day',
    subtitle: null,
    config: {
      productId: 'prod-sony-wh-1000xm5-wireless-headphones',
      // A fixed offset from render time. Real campaigns carry `endsAt` instead —
      // a countdown that restarts on every page load is fake urgency.
      endsInHours: 23,
      banners: [
        {
          id: 'b-new',
          eyebrow: 'New Arrivals',
          title: 'Fresh Styles Just Landed',
          subtitle: 'Check out the latest products',
          imageUrl: imgWide('promo-new'),
          linkUrl: '/new-arrivals',
          buttonLabel: 'Shop Now',
          tone: 'mint',
        },
        {
          id: 'b-best',
          eyebrow: 'Best Selling',
          title: 'Top Picks of the Week',
          subtitle: 'What everyone else is buying',
          imageUrl: imgWide('promo-best'),
          linkUrl: '/best-sellers',
          buttonLabel: 'Shop Now',
          tone: 'sky',
        },
        {
          id: 'b-summer',
          eyebrow: 'Summer Sale',
          title: 'Up to 50% off on selected items',
          subtitle: 'Limited time only, while stocks last',
          imageUrl: imgWide('promo-summer'),
          linkUrl: '/sale',
          buttonLabel: 'Shop Now',
          tone: 'peach',
        },
      ],
    },
  },

  {
    id: 's-promos',
    type: 'promo_trio',
    title: null,
    subtitle: null,
    config: {
      banners: [
        {
          id: 'p1',
          eyebrow: 'Summer Sale',
          title: 'Up to 50% Off',
          subtitle: 'On selected items',
          imageUrl: null,
          linkUrl: '/sale',
          buttonLabel: 'Shop Now',
          tone: 'peach',
        },
        {
          id: 'p2',
          eyebrow: 'New Arrivals',
          title: 'Fresh Styles Just Landed',
          subtitle: 'The season, as it lands',
          imageUrl: null,
          linkUrl: '/new-arrivals',
          buttonLabel: 'Shop Now',
          tone: 'mint',
        },
        {
          id: 'p3',
          eyebrow: 'Special Offer',
          title: 'Extra 20% Off',
          subtitle: 'On your first order',
          imageUrl: null,
          linkUrl: '/shop',
          buttonLabel: 'Shop Now',
          couponCode: 'WELCOME20',
          tone: 'sky',
        },
      ],
    },
  },

  {
    id: 's-featured',
    type: 'product_grid',
    title: 'Featured Products',
    subtitle: null,
    config: {
      tabs: [
        { key: 'featured', label: 'Featured Products', productIds: featuredIds },
        {
          key: 'new',
          label: 'New Arrivals',
          productIds: idsWhere((product) => product.isNewArrival, 12),
        },
        {
          key: 'best',
          label: 'Best Sellers',
          productIds: idsWhere((product) => product.isBestSeller, 12),
        },
        {
          key: 'sale',
          label: 'On Sale',
          productIds: idsWhere((product) => product.salePrice !== null, 12),
        },
      ],
      limit: 12,
    },
  },

  {
    id: 's-flash',
    type: 'flash_sale',
    title: 'Flash Deals',
    subtitle: 'Ends tonight',
    config: {
      endsInHours: 8,
      productIds: idsWhere(
        (product) => product.salePrice !== null && (product.discountPercent ?? 0) >= 20,
        10,
      ),
    },
  },

  {
    id: 's-brands',
    type: 'brands',
    title: 'Top Brands',
    subtitle: null,
    config: {},
  },

  {
    id: 's-lookbook',
    type: 'lookbook',
    title: 'Lookbook',
    subtitle: 'Get inspired by our latest styles and trends',
    config: {
      ctaLabel: 'View Lookbook',
      ctaHref: '/new-arrivals',
      tiles: [
        { id: 'l1', imageUrl: imgPortrait('look-1'), linkUrl: '/category/womens-fashion', caption: 'Summer edit' },
        { id: 'l2', imageUrl: imgPortrait('look-2'), linkUrl: '/category/accessories', caption: 'The details' },
        { id: 'l3', imageUrl: imgPortrait('look-3'), linkUrl: '/category/mens-fashion', caption: 'Off duty' },
        { id: 'l4', imageUrl: imgPortrait('look-4'), linkUrl: '/category/shoes-bags', caption: 'Carry on' },
      ],
    },
  },

  {
    id: 's-testimonials',
    type: 'testimonial',
    title: 'What our customers say',
    subtitle: null,
    config: {
      items: [
        {
          id: 't1',
          quote:
            'The dress arrived two days after I ordered it and the sizing chart was actually accurate, which is more than I can say for most places.',
          authorName: 'Nusrat Jahan',
          authorTitle: 'Dhaka',
          avatarUrl: imgAvatar('t-1'),
          rating: 5,
        },
        {
          id: 't2',
          quote:
            'Returned a pair of trainers that did not fit. No interrogation, no restocking fee, refunded in four days.',
          authorName: 'Arif Hossain',
          authorTitle: 'Chattogram',
          avatarUrl: imgAvatar('t-2'),
          rating: 5,
        },
        {
          id: 't3',
          quote:
            'I buy most of my work shirts here now. The photographs match what turns up, which sounds like a low bar until you shop elsewhere.',
          authorName: 'Tanvir Ahmed',
          authorTitle: 'Sylhet',
          avatarUrl: imgAvatar('t-3'),
          rating: 4,
        },
      ],
    },
  },

  {
    id: 's-newsletter',
    type: 'newsletter',
    title: 'Subscribe to our Newsletter',
    subtitle: 'Get the latest updates on new products and upcoming sales',
    config: {},
  },
];

/** Sanity check used by the fixtures barrel — a section naming nothing is a bug. */
export const HOMEPAGE_PRODUCT_COUNT = MOCK_PRODUCTS.length;

export { imgSquare };
