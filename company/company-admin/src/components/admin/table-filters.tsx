'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Search box + status chips, both mirrored into the URL so every list view is
 * shareable and survives a refresh.
 */
export function TableFilters({
  searchPlaceholder = 'Search…',
  statusOptions,
  statusParam = 'status',
  extra,
}: {
  searchPlaceholder?: string;
  statusOptions?: FilterOption[];
  statusParam?: string;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get('search') ?? '';
  const currentStatus = searchParams.get(statusParam) ?? 'all';
  const [term, setTerm] = React.useState(currentSearch);
  const [lastSearch, setLastSearch] = React.useState(currentSearch);

  // The box mirrors the URL, so a Reset or a back button has to pull the typed
  // term back in step. Adjusted during render rather than in an effect, which
  // would show the stale term for a frame first.
  if (currentSearch !== lastSearch) {
    setLastSearch(currentSearch);
    setTerm(currentSearch);
  }

  const push = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete('page'); // any filter change returns to the first page
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    push((params) => {
      if (term.trim()) params.set('search', term.trim());
      else params.delete('search');
    });
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <form onSubmit={submit} role="search" className="w-full max-w-md">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search"
            className="pr-9 pl-9"
          />
          {term ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setTerm('');
                push((params) => params.delete('search'));
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {statusOptions?.length ? (
          <div className="scroll-x flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  push((params) => {
                    if (option.value === 'all') params.delete(statusParam);
                    else params.set(statusParam, option.value);
                  })
                }
                aria-pressed={currentStatus === option.value}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                  currentStatus === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {extra}
        {currentSearch || currentStatus !== 'all' ? (
          <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
