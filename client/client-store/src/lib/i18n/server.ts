import 'server-only';
import { cache } from 'react';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { resolveLanguage, type Language } from './languages';
import { DICTIONARIES } from './messages/dictionaries';
import { createTranslator, type Translator } from './translator';

/**
 * The language this render is in: the visitor's choice where the store offers
 * one, and otherwise the store's own — `readLocalePreference` already decides
 * that, against what the store switched on, so a hand-edited cookie can only
 * select a language the store offers.
 *
 * A store whose configuration cannot be read renders its error page in English
 * rather than failing a second time here.
 *
 * Per request, through React's `cache`: the layout, the page and every server
 * component under them ask, and should cost one read between them.
 */
export const getLanguage = cache(async (): Promise<Language> => {
  try {
    const config = await getStoreConfig();
    return resolveLanguage((await readLocalePreference(config)).language);
  } catch {
    return 'en';
  }
});

/** `const t = await getT()` in a server component, `generateMetadata`, a Server Action or a route handler. */
export const getT = cache(async (): Promise<Translator> => {
  const language = await getLanguage();
  return createTranslator(language, DICTIONARIES[language]);
});

/** The dictionary the client provider needs — `null` for English. */
export async function getMessages() {
  return DICTIONARIES[await getLanguage()];
}
