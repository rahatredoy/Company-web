import * as React from 'react';
import { formatDate, formatMoney } from '@/lib/utils';
import { intlLocale, type Language } from './languages';
import type { MessageKey, Messages } from './messages';

/**
 * The translator — one function, and the formatters that belong with it.
 *
 * **The English text is the key.** `t('Add to cart')` renders "Add to cart" in
 * an English store and whatever the Bangla dictionary maps it to in a Bangla
 * one. That keeps every call site readable as the copy it shows, needs no
 * dictionary at all for English, and makes a missing translation fall back to
 * the English sentence rather than to `product.addButton`.
 *
 * `MessageKey` is the set of keys the Bangla dictionary holds, so `t()` of a
 * literal nobody translated **fails typecheck**. Text not known until runtime —
 * a heading the store seeded, a facet label the API built — goes through
 * `t.loose()`, which translates it if the dictionary has it and shows it as it
 * came if not. That is also what makes seeded content safe to translate: a
 * homepage heading that still reads exactly "New Arrivals" is the seed's, and an
 * owner who retitled it gets their own words back untouched.
 *
 * Placeholders are `{name}`. A number passed as a value is formatted in the
 * language's own digits; pass a string for anything that must keep its digits
 * as they are (an order number, a year, a code). A key may carry a context
 * after `::` — `'Open::status'` — when one English word needs two translations.
 *
 * **A deliberate copy** of `client-admin/src/lib/i18n/translator.ts`, apart from
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
  /** A sentence with elements inside it: `t.rich('By {brand}', { brand: <Link …/> })`. */
  rich(key: MessageKey, vars: RichVars): React.ReactNode;
  /** English's two forms; `{count}` is filled in from `count` unless given. */
  plural(count: number, one: MessageKey, other: MessageKey, vars?: Vars): string;
  /** Text known only at runtime: translated when the dictionary has it, shown as-is when not. */
  loose(text: string | null | undefined, vars?: Vars): string;
  number(value: number | null | undefined, options?: Intl.NumberFormatOptions): string;
  money(amount: string | number | null | undefined, currency: string): string;
  date(input: DateInput): string;
  dateTime(input: DateInput): string;
  relative(input: DateInput): string;
}

const PLACEHOLDER = /\{(\w+)\}/g;
const CONTEXT = '::';

function sourceText(key: string): string {
  const at = key.indexOf(CONTEXT);
  return at === -1 ? key : key.slice(0, at);
}

function toDate(input: DateInput): Date | null {
  if (!input) return null;
  const date = typeof input === 'string' ? new Date(input) : input;
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createTranslator(language: Language, messages: Messages | null): Translator {
  const locale = intlLocale(language);

  const number = (value: number | null | undefined, options?: Intl.NumberFormatOptions): string =>
    value === null || value === undefined || !Number.isFinite(value)
      ? '—'
      : new Intl.NumberFormat(locale, options).format(value);

  const template = (key: string): string => messages?.[key] ?? sourceText(key);

  const fill = (text: string, vars?: Vars): string =>
    vars
      ? text.replace(PLACEHOLDER, (match, name: string) => {
          const value = vars[name];
          if (value === undefined) return match;
          return typeof value === 'number' ? number(value) : value;
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
        parts.push(value === undefined ? match[0] : typeof value === 'number' ? number(value) : value);
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
    number,
    money: (amount: string | number | null | undefined, currency: string) => formatMoney(amount, currency, locale),
    date: (input: DateInput) => formatDate(input, locale),
    dateTime: (input: DateInput) => {
      const date = toDate(input);
      return date
        ? new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }).format(date)
        : '—';
    },
    relative: (input: DateInput) => {
      const date = toDate(input);
      if (!date) return '—';
      const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
      const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31_536_000],
        ['month', 2_592_000],
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
      ];
      for (const [unit, seconds] of units) {
        if (Math.abs(diffSeconds) >= seconds) return formatter.format(Math.round(diffSeconds / seconds), unit);
      }
      return formatter.format(diffSeconds, 'second');
    },
  });

  return t;
}
