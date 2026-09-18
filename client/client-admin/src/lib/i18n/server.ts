import 'server-only';
import { cache } from 'react';
import { serverGetOptional } from '@/lib/server-api';
import type { SessionResponse } from '@/lib/types';
import { resolveLanguage, type Language } from './languages';
import { DICTIONARIES } from './messages';
import { createTranslator, type Translator } from './translator';

/**
 * The language this render is in: the store's, as the session reports it.
 *
 * The API reads it from `store_settings`, not from the tenant record — the same
 * distinction the currency needed — and reports it signed out as well, so the
 * sign-in screen is already in the store's language. Anything that fails to
 * answer is English, which is what the panel was before it had a choice.
 *
 * Per request, through React's `cache`: the root layout, the section layout
 * and the page all ask, and should cost one read between them.
 */
export const getLanguage = cache(async (): Promise<Language> => {
  const session = await serverGetOptional<SessionResponse>('/api/v1/admin/auth/session').catch(() => null);
  const store = session?.store as { language?: string } | undefined;
  return resolveLanguage(store?.language);
});

/** `const t = await getT()` in a server component, `generateMetadata`, or a route handler. */
export const getT = cache(async (): Promise<Translator> => {
  const language = await getLanguage();
  return createTranslator(language, DICTIONARIES[language]);
});
