'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COLOR_THEMES, type ColorThemeKey } from '@/themes';
import { TEMPLATE_KEYS, type TemplateKey } from '@/templates/meta';
import {
  DESIGN_PREVIEW_COOKIE,
  DESIGN_PREVIEW_MAX_AGE,
  decodePreview,
  encodePreview,
  isDesignSwitcherEnabled,
} from '@/lib/design/preview';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * The write side of the design switcher.
 *
 * Server Actions rather than a route handler because Next already refuses an
 * action invoked cross-origin — it compares `Origin` against `Host` before the
 * function runs. A hand-rolled `POST /api/design` would need that check written
 * out, and forgetting it turns the switcher into a one-click CSRF that restyles
 * a visitor's session from any page on the internet.
 *
 * These set a cookie in **one browser**. Nothing here can change what another
 * visitor sees; publishing a design for the whole store is a write to the
 * Commerce API, authorised there against a store-admin session.
 */

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: DESIGN_PREVIEW_MAX_AGE,
  secure: isProduction,
};

function asTemplate(value: FormDataEntryValue | null): TemplateKey | null {
  const raw = typeof value === 'string' ? value.replace(/-/g, '_') : '';
  return (TEMPLATE_KEYS as readonly string[]).includes(raw) ? (raw as TemplateKey) : null;
}

function asTheme(value: FormDataEntryValue | null): ColorThemeKey | null {
  const raw = typeof value === 'string' ? value.replace(/-/g, '_') : '';
  return (COLOR_THEMES as readonly string[]).includes(raw) ? (raw as ColorThemeKey) : null;
}

/**
 * Stores a preview choice.
 *
 * Setting only the template keeps the current theme and vice versa, so the two
 * halves of the panel work independently — picking a template must not silently
 * reset the colour someone just chose.
 */
export async function setDesignPreview(formData: FormData): Promise<void> {
  if (!isDesignSwitcherEnabled()) return;

  const store = await cookies();
  const current = decodePreview(store.get(DESIGN_PREVIEW_COOKIE)?.value);

  const template = asTemplate(formData.get('template')) ?? current.template;
  const theme = asTheme(formData.get('theme')) ?? current.theme;

  if (!template && !theme) return;

  store.set(DESIGN_PREVIEW_COOKIE, encodePreview({ template, theme }), COOKIE_OPTIONS);

  // The template and the theme are both resolved during server render, so the
  // whole tree has to be produced again rather than patched in the browser.
  revalidatePath('/', 'layout');
}

/** Drops the preview and returns the visitor to the store's published design. */
export async function clearDesignPreview(): Promise<void> {
  if (!isDesignSwitcherEnabled()) return;

  const store = await cookies();
  store.delete(DESIGN_PREVIEW_COOKIE);
  revalidatePath('/', 'layout');
}
