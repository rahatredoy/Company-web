'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getPublishedStoreConfig } from '@/lib/api/store';
import {
  CURRENCY_COOKIE,
  LANGUAGE_COOKIE,
  PREFERENCE_MAX_AGE,
  resolveLocalePreference,
} from '@/lib/locale/preference';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Records the visitor's language and display-currency choice.
 *
 * Validated on the server against what the store has actually switched on, so
 * the cookie can only ever hold a value the store offers — the browser is not
 * trusted to have used the select element it was given.
 *
 * `httpOnly` because nothing client-side reads this: the preference is applied
 * during server render, which is what keeps prices and dates correct in the
 * first paint rather than flickering after hydration.
 */
export async function setLocalePreference(formData: FormData): Promise<void> {
  const config = await getPublishedStoreConfig();

  const requested = {
    language: typeof formData.get('language') === 'string' ? String(formData.get('language')) : undefined,
    currency: typeof formData.get('currency') === 'string' ? String(formData.get('currency')) : undefined,
  };

  const store = await cookies();
  const current = resolveLocalePreference(config, {
    language: store.get(LANGUAGE_COOKIE)?.value,
    currency: store.get(CURRENCY_COOKIE)?.value,
  });

  // A form that submits only one select must not clear the other.
  const next = resolveLocalePreference(config, {
    language: requested.language ?? current.language,
    currency: requested.currency ?? current.currency,
  });

  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: PREFERENCE_MAX_AGE,
    secure: isProduction,
  };

  store.set(LANGUAGE_COOKIE, next.language, options);
  store.set(CURRENCY_COOKIE, next.currency, options);

  // Prices, dates and number formatting are rendered on the server, so the whole
  // tree has to be produced again rather than patched in the browser.
  revalidatePath('/', 'layout');
}
