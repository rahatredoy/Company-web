import * as React from 'react';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { intlLocale, type Language } from './languages';
import type { MessageKey, Messages } from './messages';

/**
 * The translator — one function, and the formatters that belong with it.
 *
 * **The English text is the key.** `t('Add product')` renders "Add product" in
 * an English store and whatever the Bangla dictionary maps it to in a Bangla
 * one. That keeps every call site readable as the copy it shows, needs no
 * dictionary at all for English, and makes a missing translation fall back to
 * the English sentence rather than to `products.form.addButton`.
 *
 * `MessageKey` is the set of keys the Bangla dictionary holds, so `t()` of a
 * literal that nobody translated **fails typecheck** — which is how "every
 * screen is in Bangla" stays true after the next screen is added. Text that is
 * not known until runtime (an API message, a stored enum) goes through
 * `t.loose()`, which translates it if it can and shows it as it came if not.
 *
 * Placeholders are `{name}`. A number passed as a value is formatted in the
 * language's own digits, so `t('{count} orders', { count: 5 })` reads "৫টি
 * অর্ডার" rather than mixing scripts; pass a string for anything that must keep
 * its digits as they are (an order number, a year, a code).
 *
 * A key may carry a context after `::` — `'Open::status'` — when one English
 * word needs two different translations. The context is never shown.
 *
 * **A deliberate copy** in `client-store/src/lib/i18n/translator.ts`, apart from
 * the formatters, which each app already had its own of.
 */
export type Vars = Readonly<Record<string, string | number>>;
export type RichVars = Readonly<Record<string, React.ReactNode>>;

type DateInput = string | Date | null | undefined;

export interface Translator {
  (key: MessageKey, vars?: Vars): string;
  readonly language: Language;
  /** The `Intl` locale — for the rare call that formats something itself. */
  readonly locale: string;
  /** A sentence with elements inside it: `t.rich('Delete {name}?', { name: <strong>…</strong> })`. */
  rich(key: MessageKey, vars: RichVars): React.ReactNode;
  /** English's two forms; `{count}` is filled in from `count` unless given. */
  plural(count: number, one: MessageKey, other: MessageKey, vars?: Vars): string;
  /** Text known only at runtime: translated when the dictionary has it, shown as-is when not. */
  loose(text: string | null | undefined, vars?: Vars): string;
  number(value: number | null | undefined, options?: Intl.NumberFormatOptions): string;
  money(amount: string | number | null | undefined, currency?: string): string;
  date(input: DateInput): string;
  dateTime(input: DateInput): string;
  relative(input: DateInput): string;
}

const PLACEHOLDER = /\{(\w+)\}/g;
const CONTEXT = '::';

/** The English a key shows, without its context. */
function sourceText(key: string): string {
  const at = key.indexOf(CONTEXT);
  return at === -1 ? key : key.slice(0, at);
}

export function createTranslator(language: Language, messages: Messages | null): Translator {
  const locale = intlLocale(language);

  const template = (key: string): string => messages?.[key] ?? sourceText(key);

  const fill = (text: string, vars?: Vars): string =>
    vars
      ? text.replace(PLACEHOLDER, (match, name: string) => {
          const value = vars[name];
          if (value === undefined) return match;
          return typeof value === 'number' ? formatNumber(value, locale) : value;
        })
      : text;

  const t = ((key: MessageKey, vars?: Vars) => fill(template(key), vars)) as Translator;

  Object.assign(t, {
    language,
    locale,
    rich(key: MessageKey, vars: RichVars): React.ReactNode {
      const text = template(key);
      const parts: React.ReactNode[] = [];
      let last = 0;
      for (const match of text.matchAll(PLACEHOLDER)) {
        const index = match.index ?? 0;
        if (index > last) parts.push(text.slice(last, index));
        const value = vars[match[1]!];
        parts.push(
          value === undefined ? match[0] : typeof value === 'number' ? formatNumber(value, locale) : value,
        );
        last = index + match[0].length;
      }
      if (last < text.length) parts.push(text.slice(last));
      // Children as arguments, not an array, so React asks for no keys.
      return React.createElement(React.Fragment, null, ...parts);
    },
    plural(count: number, one: MessageKey, other: MessageKey, vars?: Vars): string {
      return fill(template(count === 1 ? one : other), { count, ...vars });
    },
    loose(text: string | null | undefined, vars?: Vars): string {
      if (!text) return '';
      return fill(messages?.[text] ?? text, vars);
    },
    number: (value: number | null | undefined, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    money: (amount: string | number | null | undefined, currency?: string) =>
      formatMoney(amount, currency, locale),
    date: (input: DateInput) => formatDate(input, locale),
    dateTime: (input: DateInput) => formatDateTime(input, locale),
    relative: (input: DateInput) => formatRelative(input, locale),
  });

  return t;
}
