import { z } from 'zod';
import { moneyToNumber, toMoney } from './utils';

/**
 * Selling by measure — a kilo of something, or four hundred grams of it.
 *
 * A greengrocer does not stock a "500g cucumber" and a "1kg cucumber"; it stocks
 * cucumbers, weighs out what was asked for, and charges a rate. Modelling each
 * weight as a variant would give every vegetable four SKUs, four stock rows and
 * four prices to keep in step, and it would count the shelf in packs that do not
 * exist. So a measure product keeps **one variant**, prices it **per measure**
 * (`pricingMeasure` base units — 1000 for a per-kilo price), counts stock in
 * **base units**, and records on each order line which measure was bought.
 *
 * Everything derived from that lives here and only here: the storefront card,
 * the product page, checkout's re-pricing and the admin panel all read these
 * functions, so a price shown and a price charged cannot drift.
 */

/**
 * The unit stock is counted in — always the small one.
 *
 * Grams rather than kilos, millilitres rather than litres, so every quantity in
 * the database stays the integer the schema already requires: `order_items.
 * quantity`, `inventory_levels.available` and the ledger are untouched by this
 * feature, which is what keeps returns, refunds and the stock CHECK constraints
 * working exactly as they did. `pc` is here for the shop that sells loose eggs
 * or single bricks and wants "Per Piece" printed on the card.
 */
export const MEASURE_UNITS = ['g', 'ml', 'pc'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** How each base unit rolls up for display, largest first. */
const SCALES: Record<MeasureUnit, { step: number; label: string }[]> = {
  g: [
    { step: 1000, label: 'kg' },
    { step: 1, label: 'g' },
  ],
  ml: [
    { step: 1000, label: 'L' },
    { step: 1, label: 'ml' },
  ],
  pc: [{ step: 1, label: 'pc' }],
};

export interface MeasureOption {
  /** What the shopper reads. Typed by the owner, so "500gm" and "Half kg" both work. */
  label: string;
  /** How much of it, in base units. */
  measure: number;
}

/** A shop that names no list of its own gets this one. */
export const DEFAULT_MEASURE_OPTIONS: MeasureOption[] = [
  { label: '1kg', measure: 1000 },
  { label: '500gm', measure: 500 },
  { label: '250gm', measure: 250 },
  { label: '100gm', measure: 100 },
];

/** Ten is a dropdown; more is a catalogue of its own. */
export const MAX_MEASURE_OPTIONS = 10;

export interface MeasureConfig {
  unit: MeasureUnit;
  /** Base units the shelf price refers to. 1000 = the price is per kilo. */
  pricingMeasure: number;
  /** What is printed after the price: "Per 1kg", "Per 100g", "Per Piece". */
  pricingLabel: string;
  /** Floor on a line's *total* measure, in base units. Null means no floor. */
  minMeasure: number | null;
  options: MeasureOption[];
}

export const measureOptionSchema = z.object({
  label: z.string().trim().min(1, 'Give the option a label.').max(24),
  measure: z.coerce.number().int().min(1, 'An option has to be at least one unit.').max(10_000_000),
});

export const measureUnitSchema = z.enum(MEASURE_UNITS);

/**
 * Formats a quantity of base units the way a shopper writes it.
 *
 * 1000 g is "1kg" and 1500 g is "1.5kg", because "1500g" is a number a shop
 * assistant would never say out loud. Trailing zeros are dropped so a round
 * weight does not read as a measurement taken to three decimal places.
 */
export function formatMeasure(base: number, unit: MeasureUnit): string {
  const amount = Math.max(0, Math.round(base));
  const scales = SCALES[unit];

  for (const scale of scales) {
    if (amount >= scale.step) {
      const value = amount / scale.step;
      const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
      return text + scale.label;
    }
  }

  return String(amount) + scales[scales.length - 1]!.label;
}

/**
 * What one of a measure costs.
 *
 * Rounded **once**, here, and then treated as the line's unit price everywhere
 * downstream — the receipt, the refund, the ledger. Deriving a per-gram rate and
 * multiplying it up instead would round twice and let a kilo bought as ten
 * hundred-gram lots cost a different amount from a kilo bought as one.
 */
export function priceForMeasure(price: string | number, measure: number, pricingMeasure: number): string {
  const divisor = pricingMeasure > 0 ? pricingMeasure : 1;
  return toMoney((moneyToNumber(price) * measure) / divisor);
}

/**
 * The smallest whole number of a measure that clears the product's minimum.
 *
 * A shop selling papaya at 40/kg with a 350g floor still offers a 100g option —
 * it just cannot sell one of them, so the card opens on four. The alternative is
 * hiding every option below the floor, which leaves a shopper wanting 400g with
 * nothing to pick.
 */
export function startingQuantity(measure: number, minMeasure: number | null): number {
  if (!minMeasure || minMeasure <= 0 || measure <= 0) return 1;
  return Math.max(1, Math.ceil(minMeasure / measure));
}

/**
 * Cleans up a list the panel sent: no duplicates, biggest first, capped.
 *
 * Sorted descending because that is how a shop lists weights — the whole unit
 * first and the fractions under it — and deduplicated by *measure* rather than
 * by label, since two rows both worth 500g are one option however they are
 * spelled and a dropdown offering both is a bug the owner cannot see.
 */
export function normaliseMeasureOptions(options: MeasureOption[]): MeasureOption[] {
  const seen = new Map<number, MeasureOption>();

  for (const option of options) {
    const measure = Math.round(option.measure);
    if (measure < 1) continue;
    if (!seen.has(measure)) seen.set(measure, { label: option.label.trim(), measure });
  }

  return [...seen.values()].sort((a, b) => b.measure - a.measure).slice(0, MAX_MEASURE_OPTIONS);
}

export interface MeasureProductRow {
  sellBy: 'unit' | 'measure' | null;
  measureUnit: string | null;
  pricingMeasure: number | null;
  pricingLabel: string | null;
  minMeasure: number | null;
  measureOptions: MeasureOption[] | null;
}

/**
 * The config a storefront should show for a product, or null for a plain one.
 *
 * A product in measure mode with no list of its own falls back to the store's
 * default list, and to `DEFAULT_MEASURE_OPTIONS` if the store named none —
 * never to an empty dropdown, which would be a product that cannot be bought.
 * The pricing measure is always offered whether or not it was ticked, because a
 * price advertised per kilo that cannot be bought by the kilo reads as a trick.
 */
export function resolveMeasureConfig(
  row: MeasureProductRow,
  storeDefaults?: MeasureOption[] | null,
): MeasureConfig | null {
  if (row.sellBy !== 'measure') return null;

  const unit = (MEASURE_UNITS as readonly string[]).includes(row.measureUnit ?? '')
    ? (row.measureUnit as MeasureUnit)
    : 'g';
  const pricingMeasure = row.pricingMeasure && row.pricingMeasure > 0 ? row.pricingMeasure : 1;

  const chosen =
    row.measureOptions && row.measureOptions.length > 0
      ? row.measureOptions
      : storeDefaults && storeDefaults.length > 0
        ? storeDefaults
        : unit === 'pc'
          ? [{ label: formatMeasure(pricingMeasure, unit), measure: pricingMeasure }]
          : DEFAULT_MEASURE_OPTIONS;

  const options = normaliseMeasureOptions([
    ...chosen,
    { label: formatMeasure(pricingMeasure, unit), measure: pricingMeasure },
  ]);

  return {
    unit,
    pricingMeasure,
    pricingLabel: row.pricingLabel?.trim() || 'Per ' + formatMeasure(pricingMeasure, unit),
    minMeasure: row.minMeasure && row.minMeasure > 0 ? row.minMeasure : null,
    options,
  };
}

export type MeasureRefusal = 'not_offered' | 'unknown_measure' | 'below_minimum';

export class MeasureError extends Error {
  constructor(
    readonly refusal: MeasureRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'MeasureError';
  }
}

/**
 * Decides what a requested line actually buys, and refuses what it cannot.
 *
 * The browser sends a measure the same way it sends a quantity — as a number it
 * could have edited — so it is checked against the product's own list here
 * rather than trusted. A measure that is not on the list is refused instead of
 * snapped to the nearest one: quietly selling somebody 250g when they asked for
 * 300g is worse than telling them the option is gone.
 */
export function resolveRequestedMeasure(
  config: MeasureConfig | null,
  requested: { measure?: number | null; quantity: number },
): { measure: number; label: string; totalMeasure: number } | null {
  if (!config) {
    if (requested.measure) {
      throw new MeasureError('not_offered', 'That item is not sold by weight or volume.');
    }
    return null;
  }

  const measure = requested.measure ?? config.pricingMeasure;
  const option = config.options.find((entry) => entry.measure === measure);

  if (!option) {
    throw new MeasureError('unknown_measure', 'That size is no longer offered. Please pick another.');
  }

  const totalMeasure = option.measure * requested.quantity;

  if (config.minMeasure && totalMeasure < config.minMeasure) {
    throw new MeasureError(
      'below_minimum',
      'The smallest order for this item is ' + formatMeasure(config.minMeasure, config.unit) + '.',
    );
  }

  return { measure: option.measure, label: option.label, totalMeasure };
}

/**
 * What an order line takes off the shelf, in whatever its stock is counted in.
 *
 * The one place this multiplication is written, because getting it wrong in
 * either direction is an oversell: reserving `quantity` for a line of 2 x 500gm
 * would hold two grams of pumpkin, and releasing `totalMeasure` for an ordinary
 * line would put back five hundred shirts.
 *
 * Null `measure` means an ordinary product and the answer is the quantity — which
 * is what every line written before this feature existed reads as.
 */
export function stockUnitsOf(line: { quantity: number; measure: number | null }): number {
  return line.quantity * (line.measure && line.measure > 0 ? line.measure : 1);
}
