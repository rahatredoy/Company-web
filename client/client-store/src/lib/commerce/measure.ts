import type { MeasureSale } from '@/types';

/**
 * Selling by weight or volume, as the shop front needs to talk about it.
 *
 * A deliberate copy of the display half of `client-api/src/lib/measure.ts`, the
 * same arrangement `sanitise-html.ts` has with its twin: these apps share no
 * package, and a card that had to ask the server what 500g of something costs
 * would be a request per option per product on a page of forty.
 *
 * **The API is still the authority on money.** Everything here is an estimate
 * shown while the shopper decides, exactly like the cart's own totals: checkout
 * re-derives every price from the database and that is what is charged. The two
 * agree because the arithmetic is the same arithmetic — if `priceForMeasure`
 * changes there, change it here.
 */

export type MeasureUnit = MeasureSale['unit'];

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

/**
 * What one of a size costs, rounded once — twin of the API's `priceForMeasure`.
 *
 * Rounded here and then multiplied by the quantity, never the other way round,
 * because that is the order the till uses: a kilo bought as ten hundred-gram
 * lots has to come to the same total however the basket was filled.
 */
export function priceForMeasure(price: string | number, measure: number, pricingMeasure: number): string {
  const rate = typeof price === 'string' ? Number.parseFloat(price) : price;
  const divisor = pricingMeasure > 0 ? pricingMeasure : 1;
  const value = ((Number.isFinite(rate) ? rate : 0) * measure) / divisor;
  return value.toFixed(2);
}

/**
 * The smallest whole number of a size that clears the shop's minimum.
 *
 * A shop selling papaya at 40/kg with a 350g floor still lists a 100g option —
 * it just will not weigh out one of them — so picking 100g opens the counter on
 * four rather than hiding the option or letting the basket be refused at the
 * till. Twin of the API's `startingQuantity`, which is what enforces it.
 */
export function startingQuantity(measure: number, minMeasure: number | null): number {
  if (!minMeasure || minMeasure <= 0 || measure <= 0) return 1;
  return Math.max(1, Math.ceil(minMeasure / measure));
}

/** The size a picker opens on: the shop's own pricing measure when it is offered. */
export function defaultOption(measure: MeasureSale): { label: string; measure: number } {
  return (
    measure.options.find((option) => option.measure === measure.pricingMeasure) ??
    measure.options[0] ?? { label: formatMeasure(measure.pricingMeasure, measure.unit), measure: measure.pricingMeasure }
  );
}

/** "Min. 350gm", or nothing when the shop set no floor. */
export function minimumNote(measure: MeasureSale): string | null {
  if (!measure.minMeasure) return null;
  return 'Min. ' + formatMeasure(measure.minMeasure, measure.unit);
}
