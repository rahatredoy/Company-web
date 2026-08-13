'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import type { SearchSuggestion } from '@/types';
import { SEARCH_DEBOUNCE_MS } from '@/config';
import { cn } from '@/lib/utils';

/**
 * Store search, with autocomplete.
 *
 * Submitting navigates to `/search?q=` — a real, linkable, indexable results
 * page rather than a JavaScript-only overlay. The suggestions are a shortcut on
 * top of that, never a replacement for it.
 *
 * Debounced, and every in-flight request is aborted when the next keystroke
 * arrives. Firing a request per character is how a storefront rate-limits
 * itself out of service, and how a slow response for "dre" arrives after the
 * one for "dress" and overwrites it.
 *
 * Implemented as a combobox: arrow keys move through the list, Enter takes the
 * highlighted suggestion, Escape closes it, and `aria-activedescendant` tells a
 * screen reader which option is current while focus stays in the input.
 */
export function SearchBox({
  variant = 'inline',
  placeholder = 'Search for products…',
  className,
}: {
  variant?: 'inline' | 'icon';
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(variant === 'inline');
  const [value, setValue] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<SearchSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(-1);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const listId = React.useId();

  React.useEffect(() => {
    const term = value.trim();
    if (term.length < 2) return;

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const body = (await response.json()) as { data?: SearchSuggestion[] };

        setSuggestions(body.data ?? []);
        setOpen((body.data ?? []).length > 0);
        setActive(-1);
      } catch (error) {
        // An abort is the expected outcome of typing another character.
        if ((error as Error).name !== 'AbortError') {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [value]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Typing is what arms or clears the suggestion list, so it happens on the
   * keystroke rather than in the debounce effect. The effect is left with the
   * one thing that genuinely has to wait — the request.
   */
  const applyTerm = (next: string) => {
    setValue(next);

    if (next.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
    } else {
      setLoading(true);
    }
  };

  const go = (href: string) => {
    applyTerm('');
    router.push(href);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (active >= 0 && suggestions[active]) {
      go(suggestions[active]!.href);
      return;
    }

    const term = value.trim();
    if (!term) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (open) setOpen(false);
      else if (variant === 'icon') setExpanded(false);
      return;
    }

    if (!open || suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % suggestions.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    }
  };

  if (variant === 'icon' && !expanded) {
    return (
      <button
        type="button"
        aria-label="Search products"
        aria-expanded={false}
        onClick={() => {
          setExpanded(true);
          // Focus after paint, so the keyboard opens on mobile too.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          'grid size-11 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt',
          className,
        )}
      >
        <Search className="size-5" aria-hidden />
      </button>
    );
  }

  return (
    <div
      className={cn('relative', variant === 'icon' ? 'w-64' : 'w-full', className)}
      // Closes when focus leaves the whole widget, not on the input's blur —
      // blur fires before a click on a suggestion registers.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <form role="search" onSubmit={onSubmit}>
        <label htmlFor={`search-${listId}`} className="sr-only">
          Search products
        </label>

        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
          aria-hidden
        />

        <input
          id={`search-${listId}`}
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(event) => applyTerm(event.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
          className="h-10 w-full rounded-(--radius-pill) border border-border bg-surface-alt pl-9 pr-9 text-sm outline-none placeholder:text-subtle focus-visible:border-primary"
        />

        {loading ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle"
            aria-hidden
          />
        ) : value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              applyTerm('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-subtle hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </form>

      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto rounded-(--radius-card) border border-border bg-surface py-1.5 shadow-[var(--shadow-raised)]"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.type}-${suggestion.id}`}>
              <button
                type="button"
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(suggestion.href)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  index === active && 'bg-surface-alt',
                )}
              >
                {suggestion.imageUrl ? (
                  <span className="relative size-9 shrink-0 overflow-hidden rounded-(--radius-button) bg-surface-alt">
                    <Image
                      src={suggestion.imageUrl}
                      alt=""
                      aria-hidden
                      fill
                      sizes="36px"
                      className="object-cover"
                    />
                  </span>
                ) : (
                  <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-button) bg-surface-alt text-[10px] font-semibold uppercase text-subtle">
                    {suggestion.type === 'brand' ? 'Br' : 'Cat'}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{suggestion.label}</span>
                  {suggestion.meta ? (
                    <span className="block truncate text-xs text-subtle">{suggestion.meta}</span>
                  ) : null}
                </span>

                {suggestion.price ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {suggestion.price}
                  </span>
                ) : null}
              </button>
            </li>
          ))}

          <li className="border-t border-border pt-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(`/search?q=${encodeURIComponent(value.trim())}`);
              }}
              className="w-full px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface-alt"
            >
              See all results for “{value.trim()}”
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
