/**
 * Moving a timestamp between the API and a `<input type="datetime-local">`.
 *
 * The control has no timezone and the column does, so these deliberately work in
 * the **browser's** local clock — which is the shopkeeper's, and is the one they
 * mean when they say a sale ends at midnight. Rendering the ISO string straight
 * into the box would show UTC and silently move a Dhaka evening sale by six
 * hours; parsing the box as UTC would do the same in reverse.
 *
 * An empty box is a real answer, not a missing one: it means **no bound**, which
 * is what a null column means, so both directions round-trip empty as null.
 */

export function localInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

export function isoFromLocalInput(value: FormDataEntryValue | string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // `new Date('2026-08-18T20:00')` is parsed in the local zone, which is the
  // whole point — the shopkeeper typed their own clock.
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
