'use client';

import * as React from 'react';
import type { Language } from './languages';
import type { Messages } from './messages';
import { createTranslator, type Translator } from './translator';

export type { MessageKey } from './messages';
export type { Translator } from './translator';

/*
 * Only hooks, components and types leave this file. It is a `'use client'`
 * module, and a plain value exported from one reaches a server component as a
 * client reference rather than as the value. Server code reads
 * `@/lib/i18n/server`; the language list is `@/lib/i18n/languages`.
 */

const I18nContext = React.createContext<Translator>(createTranslator('en', null));

/**
 * Makes the visitor's language available to every client component.
 *
 * Mounted once, by the root layout, with the language the server rendered in,
 * so the first paint and hydration agree.
 *
 * **The dictionary arrives as a prop, not as an import** — the opposite of the
 * admin panel, and deliberately. A storefront is read mostly in English by
 * shoppers who should not download a Bangla dictionary to buy a shirt, and it
 * rarely re-renders its root layout, so the cost a prop has in the panel
 * (resent on every `router.refresh()`) barely arises here. An English store
 * passes `null` and ships no dictionary at all.
 */
export function I18nProvider({
  language,
  messages,
  children,
}: {
  language: Language;
  messages: Messages | null;
  children: React.ReactNode;
}) {
  const t = React.useMemo(() => createTranslator(language, messages), [language, messages]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

/** `const t = useT()` — then `t('Add to cart')`, `t.money(price, currency)`, `t.date(order.placedAt)`. */
export function useT(): Translator {
  return React.useContext(I18nContext);
}
