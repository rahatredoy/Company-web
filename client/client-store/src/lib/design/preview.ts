import 'server-only';
import { cookies, headers } from 'next/headers';
import { publicConfig } from '@/config';
import { COLOR_THEMES, type ColorThemeKey } from '@/themes';
import { TEMPLATE_KEYS, type TemplateKey } from '@/templates/meta';
import type { StoreConfig } from '@/types';

/**
 * Design preview — trying a template and a colour on for size.
 *
 * The distinction this module exists to hold is between **previewing** and
 * **publishing**:
 *
 * - A preview is a cookie in one browser. It changes what that visitor sees and
 *   is structurally incapable of reaching anyone else. Anyone may set one.
 * - Publishing changes the store for every visitor. It is a write to the
 *   Commerce API, authorised there against a store-admin session, and nothing
 *   in this file can perform it.
 *
 * Keeping them apart is what makes an open design switcher safe to ship: the
 * worst a stranger can do with it is restyle their own screen.
 *
 * Everything read here is validated against the closed template and theme sets
 * before it is returned, so a hand-edited cookie or a crafted query string
 * yields a valid design or none at all — never an arbitrary string on its way
 * to a module path or a stylesheet.
 */

export const DESIGN_PREVIEW_COOKIE = 'sf_design';

/** A week. Long enough to survive a browse, short enough to be forgotten. */
export const DESIGN_PREVIEW_MAX_AGE = 60 * 60 * 24 * 7;

export interface DesignPreview {
  template: TemplateKey | null;
  theme: ColorThemeKey | null;
  /** Where the values came from, so the UI can explain itself. */
  source: 'query' | 'cookie' | null;
}

const EMPTY: DesignPreview = { template: null, theme: null, source: null };

export function isDesignSwitcherEnabled(): boolean {
  return publicConfig.designSwitcher !== 'off';
}

export function isDesignPublishEnabled(): boolean {
  return publicConfig.designSwitcher === 'full';
}

function toTemplate(value: string | null | undefined): TemplateKey | null {
  if (!value) return null;
  const normalised = value.replace(/-/g, '_');
  return (TEMPLATE_KEYS as readonly string[]).includes(normalised)
    ? (normalised as TemplateKey)
    : null;
}

function toTheme(value: string | null | undefined): ColorThemeKey | null {
  if (!value) return null;
  const normalised = value.replace(/-/g, '_');
  return (COLOR_THEMES as readonly string[]).includes(normalised)
    ? (normalised as ColorThemeKey)
    : null;
}

/** `marketplace.luxury_black`, or a single value when only one is set. */
export function encodePreview(preview: {
  template?: TemplateKey | null;
  theme?: ColorThemeKey | null;
}): string {
  return `${preview.template ?? ''}.${preview.theme ?? ''}`;
}

export function decodePreview(raw: string | null | undefined): {
  template: TemplateKey | null;
  theme: ColorThemeKey | null;
} {
  if (!raw) return { template: null, theme: null };
  // Cap the input before splitting: a cookie is attacker-controlled length.
  const [template, theme] = raw.slice(0, 80).split('.');
  return { template: toTemplate(template), theme: toTheme(theme) };
}

/**
 * The preview in force for this request.
 *
 * A `?template=` link wins over the cookie so that sharing a preview URL shows
 * the recipient that design even if they already had a different one saved —
 * otherwise the link silently does nothing and looks broken.
 */
export async function readDesignPreview(): Promise<DesignPreview> {
  if (!isDesignSwitcherEnabled()) return EMPTY;

  const incoming = await headers();
  const fromQuery = {
    template: toTemplate(incoming.get('x-preview-template')),
    theme: toTheme(incoming.get('x-preview-theme')),
  };
  if (fromQuery.template || fromQuery.theme) return { ...fromQuery, source: 'query' };

  const store = await cookies();
  const fromCookie = decodePreview(store.get(DESIGN_PREVIEW_COOKIE)?.value);
  if (fromCookie.template || fromCookie.theme) return { ...fromCookie, source: 'cookie' };

  return EMPTY;
}

/**
 * Lays a preview over a published configuration.
 *
 * Touches `design` and nothing else. A preview cannot alter navigation, policy
 * links, payment labels or SEO — so the switcher, however it is reached, is not
 * a way to inject content into someone else's shopfront.
 */
export function applyDesignPreview(config: StoreConfig, preview: DesignPreview): StoreConfig {
  if (!preview.template && !preview.theme) return config;

  return {
    ...config,
    design: {
      templateKey: preview.template ?? config.design.templateKey,
      colorThemeKey: preview.theme ?? config.design.colorThemeKey,
    },
  };
}
