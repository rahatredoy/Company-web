import 'server-only';
import { cookies } from 'next/headers';
import type { StoreConfig } from '@/types';

/**
 * The visitor's language and display-currency preference.
 *
 * Both are validated against what the store has actually enabled, so a
 * hand-edited cookie can only ever select something the store already offers.
 * Anything else falls back to the store's own default.
 *
 * **Currency is a display preference, never an authority.** The amount a
 * customer is charged is decided by the API at checkout, in the store's
 * settlement currency, and is recorded on the order. Converting for display and
 * then trusting that number at payment time is how a shop ends up honouring a
 * price it did not mean to offer.
 */

export const LANGUAGE_COOKIE = 'sf_lang';
export const CURRENCY_COOKIE = 'sf_currency';
export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 180;

export interface LocalePreference {
  language: string;
  currency: string;
  /** True when the visitor has chosen something other than the store default. */
  overridden: boolean;
}

/** Cheap guard before either value is used in a cookie or an `Intl` call. */
function isPlausibleCode(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{2,8})?$/.test(value);
}

export function resolveLocalePreference(
  config: StoreConfig,
  raw: { language?: string; currency?: string },
): LocalePreference {
  const languages = config.store.languages.length > 0 ? config.store.languages : [config.store.language];
  const currencies = config.store.currencies.length > 0 ? config.store.currencies : [config.store.currency];

  const language =
    isPlausibleCode(raw.language) && languages.includes(raw.language)
      ? raw.language
      : config.store.language;

  const currency =
    isPlausibleCode(raw.currency) && currencies.includes(raw.currency.toUpperCase())
      ? raw.currency.toUpperCase()
      : config.store.currency;

  return {
    language,
    currency,
    overridden: language !== config.store.language || currency !== config.store.currency,
  };
}

export async function readLocalePreference(config: StoreConfig): Promise<LocalePreference> {
  const store = await cookies();
  return resolveLocalePreference(config, {
    language: store.get(LANGUAGE_COOKIE)?.value,
    currency: store.get(CURRENCY_COOKIE)?.value,
  });
}

/** Just the currency, for the data layer, without needing the whole config. */
export async function readCurrencyPreference(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CURRENCY_COOKIE)?.value;
  return isPlausibleCode(value) ? value.toUpperCase() : null;
}
