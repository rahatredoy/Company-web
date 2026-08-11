'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { setLocalePreference } from '@/app/actions/locale';
import { cn } from '@/lib/utils';

/**
 * Language and currency pickers.
 *
 * Native `<select>` elements inside a form that posts to a Server Action, so
 * they work before hydration, get the operating system's picker on a phone, and
 * need no JavaScript of their own beyond submitting on change.
 *
 * A selector is rendered **only when the store offers more than one option**.
 * A dropdown with a single entry is a control that cannot do anything, and the
 * design brief says not to show one.
 */

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  bn: 'বাংলা',
  hi: 'हिन्दी',
  ar: 'العربية',
  es: 'Español',
  fr: 'Français',
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export function LocaleSelects({
  languages,
  currencies,
  language,
  currency,
  tone = 'inherit',
  className,
}: {
  languages: string[];
  currencies: string[];
  language: string;
  currency: string;
  tone?: 'inherit' | 'muted';
  className?: string;
}) {
  const showLanguage = languages.length > 1;
  const showCurrency = currencies.length > 1;

  if (!showLanguage && !showCurrency) return null;

  return (
    <form action={setLocalePreference} className={cn('flex items-center gap-1', className)}>
      {showLanguage ? (
        <PreferenceSelect
          name="language"
          label="Language"
          value={language}
          tone={tone}
          options={languages.map((code) => ({ value: code, label: languageName(code) }))}
        />
      ) : null}

      {showCurrency ? (
        <PreferenceSelect
          name="currency"
          label="Currency"
          value={currency}
          tone={tone}
          options={currencies.map((code) => ({ value: code, label: code }))}
        />
      ) : null}

      {/* Reached only if the browser has not run the submit-on-change handler. */}
      <noscript>
        <button type="submit" className="ml-1 text-xs underline underline-offset-2">
          Apply
        </button>
      </noscript>
    </form>
  );
}

function PreferenceSelect({
  name,
  label,
  value,
  options,
  tone,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  tone: 'inherit' | 'muted';
}) {
  const id = React.useId();

  return (
    <span className="relative inline-flex items-center">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>

      <select
        id={id}
        name={name}
        defaultValue={value}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={cn(
          'cursor-pointer appearance-none rounded-(--radius-button) bg-transparent py-1 pl-2 pr-6 text-xs font-medium outline-none',
          'transition-colors focus-visible:ring-2 focus-visible:ring-current/40',
          tone === 'muted' ? 'text-muted hover:text-foreground' : 'text-current opacity-85 hover:opacity-100',
        )}
      >
        {options.map((option) => (
          // Rendered by the browser's own picker, so these inherit its palette
          // rather than the store's — nothing to theme here.
          <option key={option.value} value={option.value} className="text-black">
            {option.label}
          </option>
        ))}
      </select>

      <ChevronDown aria-hidden className="pointer-events-none absolute right-1 size-3.5 opacity-70" />
    </span>
  );
}
