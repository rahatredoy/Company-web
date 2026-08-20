/**
 * Selling by weight or volume, as the panel needs to talk about it.
 *
 * A deliberate copy of the display half of `client-api/src/lib/measure.ts` —
 * the same arrangement as `sanitise.ts` and its twin, and for the same reason:
 * these apps share no package, and a panel that could not price an option
 * without asking the API would show a dash where the number goes.
 *
 * The API remains the authority. Nothing here decides what a customer is
 * charged; it decides what the owner is *shown* while typing, and the two agree
 * because the arithmetic is the same arithmetic. If `priceForMeasure` changes
 * there, change it here.
 */

export const MEASURE_UNITS = ['g', 'ml', 'pc'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

export interface MeasureOption {
  label: string;
  measure: number;
}

/** What the unit select offers, in the owner's words rather than the column's. */
export const MEASURE_UNIT_CHOICES: { value: MeasureUnit; label: string }[] = [
  { value: 'g', label: 'Weight (grams / kg)' },
  { value: 'ml', label: 'Volume (ml / litres)' },
  { value: 'pc', label: 'Pieces' },
];

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

export const DEFAULT_MEASURE_OPTIONS: MeasureOption[] = [
  { label: '1kg', measure: 1000 },
  { label: '500gm', measure: 500 },
  { label: '250gm', measure: 250 },
  { label: '100gm', measure: 100 },
];

export const MAX_MEASURE_OPTIONS = 10;

/** 1000 g is "1kg"; 1500 g is "1.5kg". Twin of the API's `formatMeasure`. */
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

/** Twin of the API's `priceForMeasure`. Rounded once, the same way. */
export function priceForMeasure(price: string | number, measure: number, pricingMeasure: number): string {
  const rate = typeof price === 'string' ? Number.parseFloat(price) : price;
  const divisor = pricingMeasure > 0 ? pricingMeasure : 1;
  const value = ((Number.isFinite(rate) ? rate : 0) * measure) / divisor;
  return value.toFixed(2);
}

/**
 * How much of the shelf a quantity of a line takes.
 *
 * Twin of the API's `stockUnitsOf`, and the reason inventory and order screens
 * can say "2 × 500gm (1kg)" without a second request.
 */
export function stockUnitsOf(line: { quantity: number; measure?: number | null }): number {
  return line.quantity * (line.measure && line.measure > 0 ? line.measure : 1);
}

/**
 * A stock count as the shop reads it.
 *
 * `inventory_levels.available` counts base units for a measure product, so a
 * pumpkin shelf reads 40000 in the column and "40kg" here. Plain products are
 * untouched and answer with the bare number.
 */
export function formatStock(amount: number, unit?: string | null): string {
  if (!unit || !(MEASURE_UNITS as readonly string[]).includes(unit)) return String(amount);
  return formatMeasure(amount, unit as MeasureUnit);
}
