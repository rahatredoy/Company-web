/**
 * Template identity and display metadata — the client-safe half of the registry.
 *
 * Deliberately a separate module from `registry.ts`, and it must stay free of
 * any import that reaches the server-only data layer.
 *
 * `registry.ts` holds the loader map, and a bundler follows `() => import()`
 * into the client graph even though the call is lazy. So a Client Component
 * that only wanted the list of template names — the design switcher — ended up
 * pulling every template, and through them the section renderer, the catalogue
 * reader and finally `server-only`, which fails the build with a message that
 * names none of that.
 *
 * Anything a browser needs to know about templates lives here. Anything that
 * loads one lives there.
 */

export const TEMPLATE_KEYS = [
  'marketplace',
  'modern_shop',
  'fashion_boutique',
  'minimal_store',
  'electronics',
  'lifestyle',
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DEFAULT_TEMPLATE: TemplateKey = 'modern_shop';

/**
 * A template's visual settings, in one object.
 *
 * This is the mechanism that keeps six templates from becoming six codebases.
 * The shared section kit reads its skin from here — which hero shape, how dense
 * the product rail, whether categories are circles or photographs, how much air
 * between sections — so a template file states *what it looks like* and never
 * *how any of it is built*.
 *
 * Add a field here and every template gains the option. Hard-code the same
 * choice inside one template's markup and only that template has it, until the
 * next person copies the markup and the two quietly diverge.
 */
export interface TemplatePreset {
  heroVariant: 'panel' | 'editorial' | 'gradient' | 'split' | 'fullbleed' | 'tech';
  categoryStyle: 'circle' | 'card' | 'compact' | 'editorial';
  benefitsTone: 'tinted' | 'plain' | 'bordered' | 'dark';
  /** Whether homepage product sections scroll horizontally or wrap into a grid. */
  productSectionMode: 'carousel' | 'grid';
  /** Slides visible per breakpoint in a product rail. */
  carouselPerView: { base: number; sm: number; lg: number; xl: number };
  brandStripTone: 'tinted' | 'plain' | 'cream';
  imageRatio: 'square' | 'portrait' | 'landscape';
  showUtilityBar: boolean;
  showCategorySidebar: boolean;
  showLookbook: boolean;
  showBackToTop: boolean;
  megaMenu: 'none' | 'columns' | 'columns-promo';
  sectionRhythm: 'tight' | 'normal' | 'airy';
}

/** Unknown or legacy keys fall back rather than rendering nothing at all. */
export function normaliseTemplateKey(key: string | null | undefined): TemplateKey {
  const normalised = (key ?? '').replace(/-/g, '_');
  return (TEMPLATE_KEYS as readonly string[]).includes(normalised)
    ? (normalised as TemplateKey)
    : DEFAULT_TEMPLATE;
}

/** Display metadata, for the design picker and for previews. */
export const TEMPLATE_META: Record<TemplateKey, { name: string; description: string }> = {
  marketplace: {
    name: 'Marketplace',
    description: 'Dense, search-led layout for large multi-category catalogues.',
  },
  modern_shop: {
    name: 'Modern Shop',
    description: 'Clean, balanced and conversion-focused. The default.',
  },
  fashion_boutique: {
    name: 'Fashion Boutique',
    description: 'Editorial photography and elegant type, built for apparel.',
  },
  minimal_store: {
    name: 'Minimal Store',
    description: 'Restrained and premium, for small curated catalogues.',
  },
  electronics: {
    name: 'Electronics',
    description: 'Spec-forward cards, deals and comparison for tech.',
  },
  lifestyle: {
    name: 'Lifestyle',
    description: 'Warm editorial layout for home, decor and lifestyle goods.',
  },
};
