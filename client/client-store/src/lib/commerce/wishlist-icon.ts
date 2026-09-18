import { Bookmark } from 'lucide-react';

/**
 * The wishlist glyph, in one place.
 *
 * It was a heart on all six surfaces that mention a wishlist — the card, the
 * product page, the header, the bottom bar, the account nav, "Save for later"
 * and the empty state — and a heart says *loved*, which is a different claim
 * from *on my list*. A bookmark is the saving gesture rather than a feeling
 * about the thing saved, and it keeps the two-state read the heart had: outline
 * while it is not saved, filled once it is.
 *
 * A star was the other candidate and is spoken for: the storefront already
 * prints stars for review ratings, so the same glyph would mean two things on
 * one card.
 *
 * Exported from a module carrying **no** `'use client'` directive on purpose. A
 * value exported from a client module and imported by a server component is not
 * that value — it is a client reference the bundler substitutes — and a product
 * card is a Server Component.
 */
export const WishlistIcon = Bookmark;
