import type { ComponentType } from 'react';
import type { HomepageSection, StoreConfig, StorefrontLocale } from '@/types';
import { DEFAULT_TEMPLATE, TEMPLATE_KEYS, normaliseTemplateKey, type TemplateKey, type TemplatePreset } from './meta';

/**
 * The six storefront templates.
 *
 * A template owns **composition and styling only** — header shape, footer shape,
 * hero treatment, section order, product-card presentation, grid density, type
 * scale. It owns no commerce logic whatsoever: every template renders the same
 * `components/commerce/*`, so cart maths, variant resolution and checkout rules
 * exist in exactly one place. Six copies of pricing would be six places for a
 * pricing bug to hide.
 *
 * **This module is server-side.** Loading a template reaches the section
 * renderer and through it the data layer, so importing it from a Client
 * Component drags `server-only` into the browser bundle. Anything a browser
 * needs — the key list, the display names, the preset shape — lives in
 * `./meta`, which is safe to import anywhere.
 */

export {
  TEMPLATE_KEYS,
  DEFAULT_TEMPLATE,
  TEMPLATE_META,
  normaliseTemplateKey,
  type TemplateKey,
  type TemplatePreset,
} from './meta';

export interface TemplateChromeProps {
  config: StoreConfig;
  locale: StorefrontLocale;
}

export interface TemplateChrome {
  Header: ComponentType<TemplateChromeProps>;
  Footer: ComponentType<TemplateChromeProps>;
}

export interface TemplateHomepageProps {
  config: StoreConfig;
  sections: HomepageSection[];
  locale: StorefrontLocale;
}

export interface StorefrontTemplate extends TemplateChrome {
  key: TemplateKey;
  name: string;
  description: string;
  Homepage: ComponentType<TemplateHomepageProps>;
  /** Which `ProductCard` presentation this template's grids use. */
  cardVariant: 'compact' | 'standard' | 'editorial' | 'spec' | 'wide';
  /**
   * Tailwind grid classes, mobile-first. Templates differ mainly here.
   *
   * Every one of them begins with `product-grid`, which carries no Tailwind
   * meaning at all: it is the hook `globals.css` hangs the two-across rail off
   * for a phone reading the desktop layout. A template that omits it renders six
   * cards across a 400px screen.
   */
  gridClassName: string;
  /** Whether the mobile bottom bar suits this design. */
  mobileBottomNav: boolean;
  /** Extra class applied to `<body>`, for template-level type and rhythm. */
  bodyClassName: string;
  preset: TemplatePreset;
}

/**
 * A static map, never a dynamic `import()` built from a database string. The
 * template key arrives from tenant configuration, and turning attacker- or
 * admin-supplied text into a module path would be a code-execution hole.
 */
// i18n-ignore
type TemplateLoader = () => Promise<StorefrontTemplate>;

const REGISTRY: Partial<Record<TemplateKey, TemplateLoader>> = {
  marketplace: async () => (await import('./marketplace')).default,
  modern_shop: async () => (await import('./modern-shop')).default,
  fashion_boutique: async () => (await import('./fashion-boutique')).default,
  minimal_store: async () => (await import('./minimal-store')).default,
  electronics: async () => (await import('./electronics')).default,
  lifestyle: async () => (await import('./lifestyle')).default,
};

/**
 * Loads a template, falling back rather than failing.
 *
 * A store's whole shopfront hangs off this call. If one template module is
 * broken or not yet built, that store must still be able to sell — so the
 * failure is logged and the default is served instead of a 500.
 */
export async function getTemplate(key: string | null | undefined): Promise<StorefrontTemplate> {
  const resolved = normaliseTemplateKey(key);
  const loader = REGISTRY[resolved];

  if (loader) {
    try {
      return await loader();
    } catch (error) {
      if (resolved === DEFAULT_TEMPLATE) throw error;
      console.error(`[storefront] template "${resolved}" failed to load; falling back`, error);
    }
  } else if (resolved !== DEFAULT_TEMPLATE) {
    console.warn(`[storefront] template "${resolved}" is not registered yet; using the default`);
  }

  return REGISTRY[DEFAULT_TEMPLATE]!();
}

/** Which templates a store may actually be switched to right now. */
export function registeredTemplates(): TemplateKey[] {
  return TEMPLATE_KEYS.filter((key) => key in REGISTRY);
}
