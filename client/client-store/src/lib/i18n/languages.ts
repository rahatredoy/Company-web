/**
 * The languages a storefront can be shown in.
 *
 * **A deliberate copy** of `client-api/src/lib/languages.ts`, which validates
 * the store's choice, and of `client-admin/src/lib/i18n/languages.ts`, whose
 * Settings picker is drawn from it. Change the three together, and add the
 * dictionaries in the same change: a language on this list without one saves,
 * reports success and changes nothing a shopper can see.
 *
 * English is the source language. Every string is written in it and is its own
 * key, so it needs no dictionary and is what anything unrecognised falls back to.
 *
 * `intl` is the locale numbers and dates are formatted in, which is part of
 * being in a language: a Bangla shelf that printed `Sep 14, 2026` beside its
 * own words would be half translated.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', intl: 'en-US' },
  { code: 'bn', name: 'Bangla', nativeName: 'বাংলা', intl: 'bn-BD' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isSupportedLanguage(code: string): code is Language {
  return LANGUAGES.some((language) => language.code === code);
}

/** `en-US` is English, `BN` is Bangla, anything without a dictionary is English. */
export function resolveLanguage(code: string | null | undefined): Language {
  const base = (code ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}

export function intlLocale(language: Language): string {
  return LANGUAGES.find((entry) => entry.code === language)?.intl ?? 'en-US';
}
