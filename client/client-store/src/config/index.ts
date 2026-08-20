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
   * screen. The category sidebar, the eight-across icon row and the full
   * navigation all survive; everything is simply smaller. This is done with
   * the viewport meta tag rather than with CSS, because breakpoints answer to
   * the layout viewport and this is what changes that viewport.
   *
   * **Product grids are the one exception, and they are what makes the mode
   * usable.** Six cards across 1280px is about 60px a card once the page is
   * scaled onto a 400px screen — a product photograph that small is a coloured
   * smudge and the price under it is unreadable. So on a phone-sized screen the
   * grids and the homepage rails both show exactly **two** cards, half the
   * screen each, and the rest are reached by scrolling sideways: the one gesture
   * a phone has and a monitor does not. `globals.css` holds those rules and
   * `PHONE_SCREEN_MAX_WIDTH` decides who gets them.
   *
   * `responsive` — the mobile-first layout: chrome re-flows, grids drop to two
   * columns, the bottom bar appears.
   *
   * What `desktop` still costs is type: body copy is laid out at 1280px and
   * scaled with everything else, so a shopper reading the fine print will
   * pinch-zoom to do it. Zoom is deliberately never disabled either way.
   */
  mobileLayout: (process.env.NEXT_PUBLIC_MOBILE_LAYOUT ?? 'responsive') as 'desktop' | 'responsive',

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

/**
 * The widest screen that is treated as a phone in `desktop` mobile mode.
 *
 * It is applied by the one-line script in `app/layout.tsx`, not by a media
 * query, and it has to be: in this mode the phone's layout viewport is 1280px
 * as well, so every width query answers the same on a phone as on a monitor and
 * CSS alone cannot tell the two apart. `screen` describes the device rather than
 * the viewport, so it still can.
 *
 * Measured on the **short** edge, so turning the phone does not change the
 * answer. 600 sits in the gap between the widest phones (about 440) and the
 * narrowest tablets (about 740) — a tablet reading a 1280px layout at 60% is
 * legible already and keeps the desktop grid.
 */
export const PHONE_SCREEN_MAX_WIDTH = 600;

/** Product grids and listings. Kept here so every caller agrees. */
export const PAGE_SIZE = {
  shop: 24,
  /** One batch of the homepage's whole-catalogue feed — see `catalog-feed.tsx`. */
  home: 24,
  category: 24,
  search: 24,
  reviews: 10,
  orders: 10,
} as const;

export const COMPARE_LIMIT = 4;
export const RECENTLY_VIEWED_LIMIT = 12;
export const SEARCH_DEBOUNCE_MS = 250;
