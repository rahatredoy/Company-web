/**
 * Money arithmetic for the client-side cart.
 *
 * Everything is done in integer minor units. `0.1 + 0.2` is `0.30000000000004`
 * in binary floating point, and a basket of eleven items is enough for that to
 * surface as a total a penny off the sum of its lines — which looks like theft
 * rather than like a rounding artefact.
 *
 * This exists **only** for the browser's optimistic view of the basket. The
 * server recalculates every total at checkout and its answer is the one that is
 * charged; if the two ever disagree, the server is right and this is the bug.
 */

/** Decimal string → integer minor units. `"29.99"` → `2999`. */
export function toMinor(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const value = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Integer minor units → decimal string. `2999` → `"29.99"`. */
export function toDecimal(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function multiply(amount: string, quantity: number): string {
  return toDecimal(toMinor(amount) * Math.max(0, Math.trunc(quantity)));
}

export function sum(amounts: string[]): string {
  return toDecimal(amounts.reduce((total, amount) => total + toMinor(amount), 0));
}

export function subtract(a: string, b: string): string {
  return toDecimal(Math.max(0, toMinor(a) - toMinor(b)));
}

/** Percentage of an amount, rounded to the nearest minor unit. */
export function percentOf(amount: string, percent: number): string {
  return toDecimal(Math.round((toMinor(amount) * percent) / 100));
}

export function isZero(amount: string): boolean {
  return toMinor(amount) === 0;
}
