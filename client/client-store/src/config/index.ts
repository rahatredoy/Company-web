/**
 * Public runtime configuration. Everything here reaches the browser bundle, so
 * nothing secret may ever be added — no database URL, no API key, no payment or
 * storage credential.
 */
export const publicConfig = {
  apiUrl: process.env.NEXT_PUBLIC_COMMERCE_API_URL ?? 'http://localhost:4100',
  platformRootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'company.com',

  /**
   * Local-only fallback: neither Windows nor Node resolves `*.localhost`, so in
   * development the store is named in a header instead of in the hostname. Must
   * be empty in production, where the hostname is the only identity signal.
   */
  devStoreSlug: process.env.NEXT_PUBLIC_DEV_STORE_SLUG || undefined,

  /**
   * The on-site design switcher.
   *
   * `preview` shows a floating panel letting anyone try all six templates and
   * eight colour themes. The choice is a cookie in that visitor's own browser
   * and reaches nobody else — a shopper cannot repaint a merchant's shopfront.
   * `full` adds a publish affordance for a visitor who holds a store-admin
   * session; the write is authorised by the Commerce API, never here.
   *
   * Defaults to `off` in production, so putting a design panel on a real
   * customer-facing storefront is always a deliberate act.
   */
  designSwitcher: (process.env.NEXT_PUBLIC_DESIGN_SWITCHER ??
    (process.env.NODE_ENV === 'production' ? 'off' : 'preview')) as 'off' | 'preview' | 'full',

  /**
   * How the storefront presents itself on a phone.
   *
   * `desktop` — the phone is handed the **same layout a monitor gets**, laid
   * out at `DESKTOP_LAYOUT_WIDTH` and scaled down by the browser to fit the
   * screen. The category sidebar, the eight-across icon row and the six-across
   * product grid all survive; everything is simply smaller. This is done with
   * the viewport meta tag rather than with CSS, because breakpoints answer to
   * the layout viewport and this is what changes that viewport.
   *
   * `responsive` — the mobile-first layout: chrome re-flows, grids drop to two
   * columns, the bottom bar appears.
   *
   * The trade-off is legibility, and it is not small. On a 400px-wide phone a
   * 1280px layout scales to about 31%, rendering 14px body text at roughly 4px.
   * Pinch-zoom still works — zoom is never disabled — but little is comfortably
   * readable until the visitor uses it.
   */
  mobileLayout: (process.env.NEXT_PUBLIC_MOBILE_LAYOUT ?? 'desktop') as 'desktop' | 'responsive',

  /** Loaded only when the store has configured them. */
  analytics: {
    gaMeasurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || undefined,
    metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID || undefined,
  },
} as const;

/**
 * The layout width a phone is given in `desktop` mobile mode.
 *
 * 1280 rather than 1440: it is the narrowest width at which every `xl:`
 * breakpoint still matches, so the six-across product grids and the full
 * navigation render — while keeping the scale-down factor as small as it can
 * be. A wider value would shrink everything further and buy no extra layout.
 */
export const DESKTOP_LAYOUT_WIDTH = 1280;

/** Product grids and listings. Kept here so every caller agrees. */
export const PAGE_SIZE = {
  shop: 24,
  category: 24,
  search: 24,
  reviews: 10,
  orders: 10,
} as const;

export const COMPARE_LIMIT = 4;
export const RECENTLY_VIEWED_LIMIT = 12;
export const SEARCH_DEBOUNCE_MS = 250;
