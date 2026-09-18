'use client';

import { useT, type MessageKey } from '@/lib/i18n';

/**
 * Translated text for the primitives that carry no directive.
 *
 * `Field`, `StatusBadge` and the skeletons are rendered by Server and Client
 * Components alike, so they cannot call `useT()` themselves (hooks do not run
 * in a Server Component) or `getT()` (it is server-only, and would drag
 * `server-only` into every client bundle that imports a `Badge`). A client leaf
 * in the middle of them reads the language from the provider on either side.
 */
export function TranslatedText({ text }: { text: MessageKey }) {
  const t = useT();
  return <>{t(text)}</>;
}

/** Text known only at runtime — a status the API sent — translated when the dictionary has it. */
export function LooseText({ text }: { text: string }) {
  const t = useT();
  return <>{t.loose(text)}</>;
}
