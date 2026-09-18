'use client';

import * as React from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export type LookupType = 'products' | 'variants' | 'categories' | 'brands' | 'collections' | 'customers' | 'banks';

export interface LookupOption {
  id: string;
  label: string;
  sublabel: string | null;
}

/**
 * A searchable multi-select over one kind of thing in this store.
 *
 * It asks `GET /discounts/lookup` as the owner types rather than loading a
 * catalogue into the page: a shop with four thousand products would otherwise
 * ship all of them to render a box that shows twenty. Chosen items are chips
 * above the box, named from `labels` — a map the editor holds and every picker
 * adds to, so a product chosen in one step is already named in the review —
 * and an id nobody has named yet is looked up once by id.
 *
 * Not a Radix Select: that contributes nothing to a form and cannot search.
 * The list is a plain listbox under the input, closed by Escape or a click
 * anywhere else.
 */
export function EntityPicker({
  id,
  type,
  value,
  onChange,
  labels,
  onLabels,
  placeholder,
  disabled,
  invalid,
  single = false,
}: {
  id?: string;
  type: LookupType;
  value: string[];
  onChange: (next: string[]) => void;
  /** Names already known, by id. */
  labels: Record<string, string>;
  /** Called with every option this picker learns the name of. */
  onLabels: (options: LookupOption[]) => void;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Replace rather than add. */
  single?: boolean;
}) {
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<LookupOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const root = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  // Names for chosen ids nobody has named yet — an edit form opened cold.
  const unknown = value.filter((entry) => !labels[entry]);
  const unknownKey = unknown.join(',');
  React.useEffect(() => {
    if (!unknownKey) return;
    let cancelled = false;
    api
      .get<LookupOption[]>('/api/v1/admin/discounts/lookup', { query: { type, ids: unknownKey } })
      .then((found) => {
        if (!cancelled) onLabels(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `onLabels` is the editor's stable setter; the ids are what move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, unknownKey]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .get<LookupOption[]>('/api/v1/admin/discounts/lookup', { query: { type, search: term.trim() || undefined } })
        .then((found) => {
          if (cancelled) return;
          setOptions(found);
          setActive(0);
          onLabels(found);
        })
        .catch((cause) => {
          if (!cancelled) setError(errorMessage(cause, 'Could not search.'));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, term, type]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (option: LookupOption) => {
    if (single) {
      onChange(value.includes(option.id) ? [] : [option.id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(option.id) ? value.filter((entry) => entry !== option.id) : [...value, option.id]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (open && option) toggle(option);
    }
    if (event.key === 'Backspace' && term === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div ref={root} className="relative">
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Chosen">
          {value.map((entry) => (
            <li
              key={entry}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs"
            >
              <span className="truncate">{labels[entry] ?? 'Loading…'}</span>
              {disabled ? null : (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((item) => item !== entry))}
                  className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`Remove ${labels[entry] ?? 'item'}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          value={term}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'flex h-10 w-full rounded-lg border border-input bg-background py-2 pr-9 pl-9 text-sm shadow-xs transition-colors placeholder:text-muted-foreground',
            'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none disabled:opacity-60',
            invalid && 'border-destructive',
          )}
        />
        {loading ? (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable={!single}
          className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-raised)]"
        >
          {error ? (
            <li className="px-3 py-2 text-sm text-destructive">{error}</li>
          ) : options.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{term ? 'Nothing matches that.' : 'Nothing to pick yet.'}</li>
          ) : (
            options.map((option, index) => {
              const chosen = value.includes(option.id);
              return (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={chosen}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => toggle(option)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                    index === active && 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded border',
                      chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                    aria-hidden
                  >
                    {chosen ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.sublabel ? (
                      <span className="block truncate text-xs text-muted-foreground">{option.sublabel}</span>
                    ) : null}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
