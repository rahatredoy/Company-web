'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import type { ProductVariant, VariantOption } from '@/types';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Variant selection: colour swatches, size chips.
 *
 * The important behaviour is what it does with combinations that do not exist.
 * A size is disabled when no variant pairs it with the currently selected
 * colour — so someone cannot pick Navy / XL, press Add to Cart, and be told at
 * that point that it was never available. The combination matrix comes from the
 * server; this only reads it.
 *
 * Disabled options stay visible and stay in the accessibility tree, marked
 * `aria-disabled` and struck through. Hiding them would silently change the
 * size run between colours, which reads as a rendering bug.
 */
export function VariantSelector({
  options,
  variants,
  selection,
  onChange,
  className,
}: {
  options: VariantOption[];
  variants: ProductVariant[];
  /** attributeId → attributeValueId */
  selection: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  className?: string;
}) {
  const t = useT();

  /**
   * Whether choosing `valueId` for `attributeId` leaves at least one variant
   * reachable, holding every *other* current choice fixed.
   */
  const isAvailable = React.useCallback(
    (attributeId: string, valueId: string) => {
      const others = Object.entries(selection).filter(([key]) => key !== attributeId);
      return variants.some(
        (variant) =>
          variant.selection[attributeId] === valueId &&
          others.every(([key, value]) => variant.selection[key] === value),
      );
    },
    [selection, variants],
  );

  const isInStock = React.useCallback(
    (attributeId: string, valueId: string) => {
      const others = Object.entries(selection).filter(([key]) => key !== attributeId);
      return variants.some(
        (variant) =>
          variant.inStock &&
          variant.selection[attributeId] === valueId &&
          others.every(([key, value]) => variant.selection[key] === value),
      );
    },
    [selection, variants],
  );

  const pick = (attributeId: string, valueId: string) => {
    const next = { ...selection, [attributeId]: valueId };

    /*
     * Changing colour can strand the current size. Rather than leaving an
     * impossible pair selected, the first still-valid value for each *other*
     * attribute is chosen — preferring one that is actually in stock.
     */
    for (const option of options) {
      if (option.attributeId === attributeId) continue;

      const stillValid = variants.some((variant) =>
        Object.entries(next).every(([key, value]) => variant.selection[key] === value),
      );
      if (stillValid) continue;

      const candidates = option.values.filter((value) =>
        variants.some(
          (variant) =>
            variant.selection[option.attributeId] === value.id &&
            variant.selection[attributeId] === valueId,
        ),
      );

      const preferred =
        candidates.find((value) =>
          variants.some(
            (variant) =>
              variant.inStock &&
              variant.selection[option.attributeId] === value.id &&
              variant.selection[attributeId] === valueId,
          ),
        ) ?? candidates[0];

      if (preferred) next[option.attributeId] = preferred.id;
    }

    onChange(next);
  };

  if (options.length === 0) return null;

  return (
    <div className={cn('space-y-5', className)}>
      {options.map((option) => {
        const selectedId = selection[option.attributeId];
        const selectedValue = option.values.find((value) => value.id === selectedId);

        return (
          <fieldset key={option.attributeId}>
            <legend className="mb-2 text-sm font-medium">
              {option.attributeName}
              {selectedValue ? (
                <span className="ml-1.5 font-normal text-muted">{selectedValue.value}</span>
              ) : null}
            </legend>

            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const available = isAvailable(option.attributeId, value.id);
                const inStock = isInStock(option.attributeId, value.id);
                const selected = value.id === selectedId;

                const label = !available
                  ? t('{value} — not available', { value: value.value })
                  : !inStock
                    ? t('{value} — out of stock', { value: value.value })
                    : value.value;

                if (option.inputType === 'color') {
                  return (
                    <button
                      key={value.id}
                      type="button"
                      onClick={() => available && pick(option.attributeId, value.id)}
                      aria-label={label}
                      aria-pressed={selected}
                      aria-disabled={!available}
                      className={cn(
                        'relative grid size-9 place-items-center rounded-full border-2 transition-all',
                        selected ? 'border-primary' : 'border-border',
                        available ? 'hover:border-border-strong' : 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-6 rounded-full border border-black/10"
                        style={{ backgroundColor: value.colorHex ?? 'transparent' }}
                      />
                      {selected ? (
                        <Check
                          aria-hidden
                          className="absolute size-4 text-white mix-blend-difference"
                        />
                      ) : null}
                      {/* A diagonal rule, so "unavailable" is not conveyed by opacity alone. */}
                      {!available ? (
                        <span
                          aria-hidden
                          className="absolute h-px w-8 rotate-45 bg-foreground/60"
                        />
                      ) : null}
                    </button>
                  );
                }

                return (
                  <button
                    key={value.id}
                    type="button"
                    onClick={() => available && pick(option.attributeId, value.id)}
                    aria-label={label}
                    aria-pressed={selected}
                    aria-disabled={!available}
                    className={cn(
                      'min-w-11 rounded-(--radius-button) border px-3 py-2 text-sm font-medium transition-colors',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border-strong hover:bg-surface-alt',
                      !available && 'cursor-not-allowed text-subtle line-through opacity-50',
                      available && !inStock && !selected && 'text-subtle',
                    )}
                  >
                    {value.value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** The variant matching a selection, or null when the pair does not exist. */
export function findVariant(
  variants: ProductVariant[],
  selection: Record<string, string>,
): ProductVariant | null {
  const keys = Object.keys(selection);
  if (keys.length === 0) return variants[0] ?? null;

  return (
    variants.find((variant) => keys.every((key) => variant.selection[key] === selection[key])) ??
    null
  );
}

/** The default selection: the first in-stock variant, else the first at all. */
export function initialSelection(variants: ProductVariant[], defaultVariantId: string | null) {
  const preferred =
    variants.find((variant) => variant.id === defaultVariantId) ??
    variants.find((variant) => variant.inStock) ??
    variants[0];

  return preferred ? { ...preferred.selection } : {};
}
