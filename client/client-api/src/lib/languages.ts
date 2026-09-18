/**
 * The languages a store may run in.
 *
 * A list rather than "any code", because a language is only worth offering once
 * every screen can actually be shown in it: the panel, the storefront and the
 * messages this API writes all carry a dictionary per entry here, and a code
 * with no dictionary behind it would save, report success, and change nothing
 * the owner can see.
 *
 * English is the source language — every message is written in it and is its
 * own key — so it needs no dictionary and is what anything unrecognised falls
 * back to.
 *
 * **A deliberate copy** — `client-admin/src/lib/i18n/languages.ts` draws the
 * Settings picker from the same list, and `client-store/src/lib/i18n/languages.ts`
 * resolves a visitor's language against it. Change the three together, and add
 * the dictionaries in the same change.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'bn', name: 'Bangla', nativeName: 'বাংলা' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isSupportedLanguage(code: string): code is Language {
  return LANGUAGES.some((language) => language.code === code);
}

/**
 * Whichever supported language a stored or requested code means.
 *
 * Stores provisioned before the list existed can hold a regional code such as
 * `en-US`, which is English for every purpose here; anything with no dictionary
 * at all is English too, rather than a half-translated screen.
 */
export function resolveLanguage(code: string | null | undefined): Language {
  const base = (code ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}
