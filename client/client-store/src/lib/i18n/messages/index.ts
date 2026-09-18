import type bn from './bn';

/**
 * Types only. The dictionaries themselves are `./dictionaries.ts`, which is
 * server-only: a client component that imported a dictionary would put every
 * translation into the storefront bundle, English stores included. The root
 * layout hands the one a visitor needs to `I18nProvider` instead.
 */

/** A dictionary: English source text → the same text in one other language. */
export type Messages = Readonly<Record<string, string>>;

/**
 * Every string `t()` accepts — the keys of the Bangla dictionary.
 *
 * Typed from the dictionary rather than from the call sites, so an untranslated
 * literal is a typecheck error in the file that uses it. See `translator.ts`.
 */
export type MessageKey = keyof typeof bn & string;
