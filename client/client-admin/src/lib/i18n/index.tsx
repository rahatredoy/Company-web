'use client';

import * as React from 'react';
import type { Language } from './languages';
import { DICTIONARIES } from './messages';
import { createTranslator, type Translator } from './translator';

export type { MessageKey } from './messages';
export type { Translator } from './translator';

/*
 * Only hooks, components and types leave this file. It is a `'use client'`
 * module, and a plain value exported from one reaches a server component as a
 * client reference rather than as the value — the trap `lib/list.ts` documents.
 * Server code reads `@/lib/i18n/server`; the language list is
 * `@/lib/i18n/languages`.
 */

const I18nContext = React.createContext<Translator>(createTranslator('en', null));

/**
 * Makes the store's language available to every client component.
 *
 * Mounted once, by the root layout, with the language the server rendered in —
 * so the first paint and hydration agree, and a `router.refresh()` after the
 * owner changes it in Settings re-renders the whole panel in the new one.
 *
 * The dictionary is imported into the bundle here rather than passed down as a
 * prop. The panel refreshes after nearly every save, and a prop would put the
 * whole dictionary back into every one of those payloads; a bundled chunk is
 * downloaded once and cached.
 */
export function I18nProvider({ language, children }: { language: Language; children: React.ReactNode }) {
  const t = React.useMemo(() => createTranslator(language, DICTIONARIES[language]), [language]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

/** `const t = useT()` — then `t('Save')`, `t.money(total, currency)`, `t.date(order.placedAt)`. */
export function useT(): Translator {
  return React.useContext(I18nContext);
}
