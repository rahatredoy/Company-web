'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal, X } from 'lucide-react';
import type { FilterGroup, SortValue } from '@/types';
import { SORT_OPTIONS } from '@/types';
import { Button } from '@/components/ui/button';
import { useT, type MessageKey, type Translator } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

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

      // Any filter change starts the listing again. `page` only ever appears in
      // the URL for a visitor with no JavaScript, and batch seven of a narrower
      // result set is usually empty.
      next.delete('page');

      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: true });
    },
    [params, pathname, router],
  );

  return { params, apply };
}

export function SortSelect({ value }: { value: SortValue }) {
  const t = useT();
  const { apply } = useUrlState();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="whitespace-nowrap text-sm text-muted">
        {t('Sort by')}
      </label>
      <select
        id="sort"
        value={value}
        onChange={(event) => apply({ sort: event.target.value })}
        className="h-10 rounded-(--radius-input) border border-border bg-surface px-3 text-sm outline-none focus-visible:border-primary"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t.loose(option.label)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The panel's own words, looked up by what the API sends that does not change.
 *
 * A group's `key` and an offer's `value` are the contract; the `label` beside
 * them is English written for any reader of the endpoint. Translating by key
 * means a relabelled facet on the API side cannot silently fall out of the
 * dictionary. An attribute group (Size, Material) is the store's own name and
 * goes through `t.loose`, and a brand's or a category's name is never touched.
 */
const GROUP_LABELS: Record<string, MessageKey> = {
  sub: 'Category',
  offer: 'Offers',
  price: 'Price',
  brand: 'Brand',
  inStock: 'Availability',
};

const OFFER_LABELS: Record<string, MessageKey> = {
  on_sale: 'On Sale',
  discounted: 'Discounted',
  flash_deal: 'Flash Deal',
  clearance: 'Clearance',
  coupon: 'Coupon Available',
  best_seller: 'Best Seller',
  trending: 'Trending',
  top_rated: 'Top Rated',
};

function groupLabel(group: FilterGroup, t: Translator): string {
  const key = GROUP_LABELS[group.key];
  return key ? t(key) : t.loose(group.label);
}

/**
 * A price band, written in the store's money.
 *
 * The API sends the bounds as numbers and a bare-number label beside them,
 * because the currency symbol and the thousands separator are this app's
 * knowledge: it holds the store's currency and the visitor's locale, and "৳" is
 * half the width of "BDT" in a column this narrow. A band that somehow arrives
 * without bounds falls back to the label the API sent rather than to nothing.
 */
function optionLabel(
  option: FilterGroup['options'][number],
  group: FilterGroup,
  locale: string,
  currency: string,
  t: Translator,
): string {
  if (group.key === 'offer') {
    const key = OFFER_LABELS[option.value];
    return key ? t(key) : t.loose(option.label);
  }
  if (group.key === 'inStock') return t('In stock');
  if (group.type !== 'price' || option.min === undefined) return option.label;

  const money = (amount: number) => formatMoney(amount, currency, locale);
  if (option.max === null || option.max === undefined) return t('{amount}+', { amount: money(option.min) });
  if (option.min === 0) return t('Under {amount}', { amount: money(option.max) });
  return `${money(option.min)} – ${money(option.max)}`;
}

function FilterGroups({
  filters,
  locale,
  currency,
}: {
  filters: FilterGroup[];
  locale: string;
  currency: string;
}) {
  const t = useT();
  const { params, apply } = useUrlState();

  return (
    <div className="space-y-6">
      {filters.map((group) => {
        const selected = params.getAll(group.key);

        return (
          <fieldset key={group.key}>
            <legend className="mb-3 text-sm font-semibold">{groupLabel(group, t)}</legend>
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
                      <span className="flex-1">{optionLabel(option, group, locale, currency, t)}</span>
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
 * `sub` used to be in this list, back when the subcategory chips above the grid
 * owned it. The Category group owns it now — the chips were the same control
 * drawn a second time, in a place with no counts and room for one choice — so
 * clearing the filters clears it like anything else in the panel.
 */
const NOT_OURS = ['sort', 'q', 'template', 'theme'];

export function DesktopFilters({
  filters,
  locale,
  currency,
}: {
  filters: FilterGroup[];
  locale: string;
  currency: string;
}) {
  const t = useT();
  const { params, apply } = useUrlState();
  const hasAny = [...params.keys()].some((key) => key !== 'page' && !NOT_OURS.includes(key));

  if (filters.length === 0) return null;

  return (
    <aside aria-label={t('Filters')} className="hidden w-60 shrink-0 lg:block">
      <div className="sticky top-24">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('Filters')}</h2>
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
              {t('Clear all')}
            </button>
          ) : null}
        </div>
        <FilterGroups filters={filters} locale={locale} currency={currency} />
      </div>
    </aside>
  );
}

/** On small screens filters live in a sheet, per the mobile UX requirement. */
export function MobileFilters({
  filters,
  total,
  locale,
  currency,
}: {
  filters: FilterGroup[];
  total: number;
  locale: string;
  currency: string;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  if (filters.length === 0) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal /> {t('Filters')}
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-base font-semibold">{t('Filters')}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label={t('Close filters')} className="grid size-10 place-items-center rounded-full hover:bg-surface-alt">
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {t('Narrow these products by category, offer, price, brand and availability.')}
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            <FilterGroups filters={filters} locale={locale} currency={currency} />
          </div>

          <div className="border-t border-border p-4">
            <Button className="w-full" onClick={() => setOpen(false)}>
              {t.plural(total, 'Show {count} product', 'Show {count} products')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
