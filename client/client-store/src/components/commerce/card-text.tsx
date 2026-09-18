'use client';

import type { MeasureSale } from '@/types';
import { useT, type MessageKey } from '@/lib/i18n';
import { minimumNote, pricingLabelOf } from '@/lib/commerce/measure';

/**
 * The words on a product card, in the visitor's language.
 *
 * `ProductCard` and the `PriceDisplay` inside it are rendered by server
 * components and client components alike, and stay isomorphic on purpose — a
 * hundred cards on a listing should not ship their markup twice. A server component cannot read the translator
 * from context and a client one cannot await it, so the few phrases the card
 * prints are these two small client leaves instead. Their props are plain
 * strings and numbers, so they cross the boundary from either side.
 */
export function CardText({
  text,
  vars,
}: {
  text: MessageKey;
  vars?: Readonly<Record<string, string | number>>;
}) {
  const t = useT();
  return <>{t(text, vars)}</>;
}

/** "Per 1kg (Min. 350gm)" — the rate a price by weight is quoted at, and the shop's floor. */
export function MeasureRate({ measure }: { measure: MeasureSale }) {
  const t = useT();
  const minimum = minimumNote(measure, t);
  return (
    <>
      {pricingLabelOf(measure, t)}
      {minimum ? ' (' + minimum + ')' : ''}
    </>
  );
}
