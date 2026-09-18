/**
 * The languages the panel — and the store it runs — can be shown in.
 *
 * **A deliberate copy** of `client-api/src/lib/languages.ts`, which validates
 * the Settings picker drawn from this list, and of
 * `client-store/src/lib/i18n/languages.ts`, which resolves a shopper's language
 * against it. Change the three together, and add the dictionaries in the same
 * change: a language on this list without one saves, reports success and
 * changes nothing the owner can see.
 *
 * English is the source language. Every string is written in it and is its own
 * key, so it needs no dictionary and is what anything unrecognised falls back to.
 *
 * `intl` is the locale numbers and dates are formatted in, which is part of
 * being in a language: a Bangla screen that printed `Sep 14, 2026` beside its
 * own words would be half translated. `en-US` is what the panel always used, so
 * an English store renders exactly what it did before.
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
