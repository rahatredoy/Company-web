'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal, X } from 'lucide-react';
import type { FilterGroup, SortValue } from '@/types';
import { SORT_OPTIONS } from '@/types';
import { Button } from '@/components/ui/button';
import { RatingStars } from '@/components/commerce/rating-stars';
import { cn } from '@/lib/utils';

/**
 * Sorting and filtering both work by rewriting the URL.
 *
 * That keeps a filtered listing linkable, shareable, back-button-friendly and
 * crawlable — none of which is true of filters held only in React state. The
 * server re-reads and re-validates every value, so a hand-edited URL cannot
 * produce a listing the API would not have allowed.
 */

function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = React.useCallback(
    (changes: Record<string, string | string[] | null>) => {
      const next = new URLSearchParams(params.toString());

      for (const [key, value] of Object.entries(changes)) {
        next.delete(key);
        if (value === null) continue;
        if (Array.isArray(value)) value.forEach((entry) => next.append(key, entry));
        else next.set(key, value);
      }

      // Any filter change returns to page one; page 7 of a narrower result set
      // is usually empty.
      next.delete('page');

      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: true });
    },
    [params, pathname, router],
  );

  return { params, apply };
}

export function SortSelect({ value }: { value: SortValue }) {
  const { apply } = useUrlState();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="whitespace-nowrap text-sm text-muted">
        Sort by
      </label>
      <select
        id="sort"
        value={value}
        onChange={(event) => apply({ sort: event.target.value })}
        className="h-10 rounded-(--radius-input) border border-border bg-surface px-3 text-sm outline-none focus-visible:border-primary"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterGroups({ filters }: { filters: FilterGroup[] }) {
  const { params, apply } = useUrlState();

  return (
    <div className="space-y-6">
      {filters.map((group) => {
        const selected = params.getAll(group.key);

        if (group.type === 'range') {
          return (
            <fieldset key={group.key}>
              <legend className="mb-3 text-sm font-semibold">{group.label}</legend>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="minPrice">
                  Minimum price
                </label>
                <input
                  id="minPrice"
                  type="number"
                  inputMode="numeric"
                  min={group.min}
                  max={group.max}
                  defaultValue={params.get('minPrice') ?? ''}
                  placeholder={String(group.min ?? 0)}
                  onBlur={(event) => apply({ minPrice: event.target.value || null })}
                  className="h-10 w-full rounded-(--radius-input) border border-border bg-surface px-3 text-sm outline-none focus-visible:border-primary"
                />
                <span className="text-subtle" aria-hidden>
                  –
                </span>
                <label className="sr-only" htmlFor="maxPrice">
                  Maximum price
                </label>
                <input
                  id="maxPrice"
                  type="number"
                  inputMode="numeric"
                  min={group.min}
                  max={group.max}
                  defaultValue={params.get('maxPrice') ?? ''}
                  placeholder={String(group.max ?? 0)}
                  onBlur={(event) => apply({ maxPrice: event.target.value || null })}
                  className="h-10 w-full rounded-(--radius-input) border border-border bg-surface px-3 text-sm outline-none focus-visible:border-primary"
                />
              </div>
            </fieldset>
          );
        }

        return (
          <fieldset key={group.key}>
            <legend className="mb-3 text-sm font-semibold">{group.label}</legend>
            <ul className="space-y-1.5">
              {group.options.map((option) => {
                const checked = selected.includes(option.value);
                const id = `${group.key}-${option.value}`;

                return (
                  <li key={option.value}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        id={id}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          apply({
                            [group.key]: checked
                              ? selected.filter((entry) => entry !== option.value)
                              : [...selected, option.value],
                          })
                        }
                        className="size-4 accent-[var(--primary)]"
                      />
                      {group.type === 'rating' ? (
                        <RatingStars rating={Number(option.value)} showCount={false} size="xs" />
                      ) : null}
                      <span className="flex-1">{option.label}</span>
                      <span className="text-xs text-subtle">{option.count}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Parameters this sidebar does not own, so "Clear all" leaves them alone.
 *
 * `sub` is in the list because the subcategory chips are their own control, sat
 * above the grid with their own visible way to switch one off; wiping them from
 * a button in another column would look like the page had lost its place.
 */
const NOT_OURS = ['sort', 'q', 'sub', 'template', 'theme'];

export function DesktopFilters({ filters }: { filters: FilterGroup[] }) {
  const { params, apply } = useUrlState();
  const hasAny = [...params.keys()].some((key) => key !== 'page' && !NOT_OURS.includes(key));

  if (filters.length === 0) return null;

  return (
    <aside aria-label="Filters" className="hidden w-60 shrink-0 lg:block">
      <div className="sticky top-24">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Filters</h2>
          {hasAny ? (
            <button
              type="button"
              onClick={() =>
                apply(
                  Object.fromEntries(
                    [...params.keys()].filter((key) => !NOT_OURS.includes(key)).map((key) => [key, null]),
                  ),
                )
              }
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        <FilterGroups filters={filters} />
      </div>
    </aside>
  );
}

/** On small screens filters live in a sheet, per the mobile UX requirement. */
export function MobileFilters({ filters, total }: { filters: FilterGroup[]; total: number }) {
  const [open, setOpen] = React.useState(false);

  if (filters.length === 0) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal /> Filters
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-base font-semibold">Filters</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close filters" className="grid size-10 place-items-center rounded-full hover:bg-surface-alt">
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Narrow these products by brand, price, rating and availability.</Dialog.Description>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            <FilterGroups filters={filters} />
          </div>

          <div className="border-t border-border p-4">
            <Button className="w-full" onClick={() => setOpen(false)}>
              Show {total} {total === 1 ? 'product' : 'products'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Pagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  const { params } = useUrlState();
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams(params.toString());
    next.set('page', String(target));
    return `?${next.toString()}`;
  };

  // Real links, so pagination is crawlable and openable in a new tab.
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 1,
  );

  return (
    <nav aria-label="Pagination" className="mt-10 flex justify-center">
      <ul className="flex items-center gap-1">
        {page > 1 ? (
          <li>
            <a href={href(page - 1)} className="rounded-(--radius-button) border border-border px-3 py-2 text-sm hover:bg-surface-alt">
              Previous
            </a>
          </li>
        ) : null}

        {pages.map((candidate, index) => (
          <React.Fragment key={candidate}>
            {index > 0 && candidate - pages[index - 1]! > 1 ? (
              <li aria-hidden className="px-1 text-subtle">
                …
              </li>
            ) : null}
            <li>
              <a
                href={href(candidate)}
                aria-current={candidate === page ? 'page' : undefined}
                className={cn(
                  'grid size-10 place-items-center rounded-(--radius-button) border text-sm',
                  candidate === page
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:bg-surface-alt',
                )}
              >
                {candidate}
              </a>
            </li>
          </React.Fragment>
        ))}

        {page < totalPages ? (
          <li>
            <a href={href(page + 1)} className="rounded-(--radius-button) border border-border px-3 py-2 text-sm hover:bg-surface-alt">
              Next
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
