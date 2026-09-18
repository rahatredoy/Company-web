import type { Language } from '../languages';
import bn from './bn';

/** A dictionary: English source text → the same text in one other language. */
export type Messages = Readonly<Record<string, string>>;

/**
 * Every string `t()` accepts — the keys of the Bangla dictionary.
 *
 * Typed from the dictionary rather than from the call sites, so an untranslated
 * literal is a typecheck error in the file that uses it. See `translator.ts`.
 */
export type MessageKey = keyof typeof bn & string;

/** English is the key itself, so it has no dictionary to load. */
export const DICTIONARIES: Record<Language, Messages | null> = {
  en: null,
  bn,
};
