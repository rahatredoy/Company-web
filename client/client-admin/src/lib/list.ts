/**
 * Rows per batch, for every list in the panel.
 *
 * It lives here rather than beside `useInfiniteList` because both halves of a
 * list need it and they run in different places: the server component reads the
 * first batch with it, and the browser hook asks for the rest with it. A value
 * exported from a `'use client'` module and imported by a server component is
 * **not** that value — it is a client reference the bundler substitutes, so
 * `pageSize=[object Object]` reaches the API and the list 422s. This module has
 * no directive, so it is the same number on both sides.
 *
 * The API caps a batch at 100. This is what feels immediate: enough to fill a
 * tall screen in one round trip, few enough that the next one lands before the
 * reader gets there.
 */
export const BATCH_SIZE = 25;

/**
 * What the product list opens sorted by, when the URL says nothing.
 *
 * Here rather than beside `PRODUCT_DEFAULTS` for the reason above, and it was the
 * same bug: `products/page.tsx` is a server component and reads this as the
 * fallback for a missing `?sort=`, so reading it off `PRODUCT_DEFAULTS` — exported
 * from `product-manager.tsx`, which is `'use client'` — handed it a client
 * reference whose every property is `undefined`. The list still sorted correctly,
 * because an omitted `sort` leaves the API on its own default of the same
 * column; what showed was a literal `?sort=undefined&order=undefined` in the URL
 * of every filter change made from an unsorted list, and a sort arrow that never
 * appeared on the column actually in use.
 *
 * `PRODUCT_DEFAULTS` is built from this, so the page and the panel cannot
 * disagree about it. The orders list still reads its own defaults the broken
 * way.
 */
export const PRODUCT_LIST_SORT = { sort: 'createdAt', order: 'desc' } as const;
