import type { FastifyRequest } from 'fastify';
import type { Language } from '../languages';
import { logger } from '../logger';
import { loadStoreLanguage } from '../store-currency';
import bn from './bn/index';
import { BN_PATTERNS, type MessagePattern } from './bn/patterns';

/**
 * What this API says, in the language of the store it is saying it for.
 *
 * Messages are written in English at the throw site, exactly as they always
 * were, and translated **on the way out** — by `plugins/error-handler.ts` for
 * every error and its per-field `details`, and by `translateFor` for the few
 * success bodies that carry a sentence. So a route never needs to know the store
 * has a language, and a message nobody has translated yet is still sent, in
 * English, rather than as nothing.
 *
 * Two kinds of entry, tried in order:
 *
 *   1. **exact** — the English sentence is the key (`bn/*.ts`), which is how the
 *      two frontends' dictionaries work too;
 *   2. **patterns** — for a message built with values in it, including Zod's own
 *      defaults ("Too small: expected string to have >=3 characters"), a regular
 *      expression and a function that writes the sentence around what it caught.
 *
 * English stores skip both.
 */

const DICTIONARIES: Record<Language, { exact: Readonly<Record<string, string>>; patterns: readonly MessagePattern[] } | null> = {
  en: null,
  bn: { exact: bn, patterns: BN_PATTERNS },
};

export function translate(language: Language, text: string): string {
  const dictionary = DICTIONARIES[language];
  if (!dictionary || !text) return text;

  const exact = dictionary.exact[text];
  if (exact !== undefined) return exact;

  for (const [pattern, render] of dictionary.patterns) {
    const match = pattern.exec(text);
    if (match) return render(match);
  }
  return text;
}

export function translateDetails(
  language: Language,
  details: Record<string, string[]>,
): Record<string, string[]> {
  if (!DICTIONARIES[language]) return details;
  return Object.fromEntries(
    Object.entries(details).map(([field, messages]) => [field, messages.map((message) => translate(language, message))]),
  );
}

/**
 * Which language a response to this request is written in: its store's.
 *
 * Bounded, because this runs on the error path — where the error being reported
 * may well be the database or Redis being unreachable — and a translation is
 * never worth a response that hangs or throws a second time. No store (a
 * tenant-exempt route, or the store could not be resolved) is English.
 */
export async function languageOf(request: FastifyRequest): Promise<Language> {
  const store = request.store;
  if (!store) return 'en';

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      loadStoreLanguage(store),
      new Promise<Language>((resolve) => {
        timer = setTimeout(() => resolve('en'), LANGUAGE_LOOKUP_MS);
      }),
    ]);
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'store language lookup failed; answering in English');
    return 'en';
  } finally {
    clearTimeout(timer);
  }
}

/** A sentence in a success body, in the store's language. */
export async function translateFor(request: FastifyRequest, text: string): Promise<string> {
  return translate(await languageOf(request), text);
}

const LANGUAGE_LOOKUP_MS = 250;
