import type { Metadata, Viewport } from 'next';
import { Geist, Noto_Sans_Bengali, Playfair_Display, Space_Grotesk } from 'next/font/google';
import { DESKTOP_LAYOUT_WIDTH, PHONE_SCREEN_MAX_WIDTH, publicConfig } from '@/config';
import { getStoreConfig } from '@/lib/api/store';
import { getTemplate } from '@/templates/registry';
import { resolveTheme } from '@/themes';
import { ThemeStyle } from '@/components/layout/theme-style';
import { StoreGate, isStoreTrading } from '@/components/layout/store-gate';
import { BackToTop } from '@/components/layout/back-to-top';
import { CartCurrencySync } from '@/components/commerce/cart-currency-sync';
import { WhatsAppButton } from '@/components/layout/whatsapp-button';
import { MobileBottomNav, MobileBottomNavSpacer } from '@/components/layout/mobile-bottom-nav';
import { DesignSwitcherMount } from '@/components/design/design-switcher-mount';
import { StorefrontProviders } from './providers';
import { readLocalePreference } from '@/lib/locale/preference';
import { I18nProvider } from '@/lib/i18n';
import { getLanguage, getMessages, getT } from '@/lib/i18n/server';
import './globals.css';

/**
 * Three faces, because a template chooses its own voice.
 *
 * The variable names end in `-family` and are mapped onto Tailwind's
 * `--font-*` keys in `globals.css`. Naming both sides the same is what made
 * `--font-display: var(--font-display)` resolve to nothing.
 *
 * Only the body face is preloaded. The display and technical faces are used by
 * three templates each, so preloading them on every store would download two
 * fonts that most pages never paint with.
 */
const sans = Geist({
  variable: '--font-sans-family',
  subsets: ['latin'],
  display: 'swap',
});

const display = Playfair_Display({
  variable: '--font-display-family',
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  // Italic is not optional: the accent word in "Find Your *Style*" is the
  // whole signature of the editorial hero.
  style: ['normal', 'italic'],
  display: 'swap',
  preload: false,
});

/*
 * No `weight` here, deliberately. Space Grotesk is a variable font, and asking
 * this Next version's font loader for specific static instances of it fails the
 * build with an unresolvable `@vercel/turbopack-next/internal/font/google/font`
 * import. Omitting `weight` loads the variable file, which is what we want
 * anyway — every weight, one download.
 */
const technical = Space_Grotesk({
  variable: '--font-technical-family',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
});

/*
 * None of the three faces has Bengali glyphs, so a Bangla shop would otherwise
 * be set in whatever each shopper's operating system falls back to. It is named
 * after the template's face in every stack (`globals.css`), so Latin text keeps
 * the template's voice, and it is not preloaded: the file is fetched only once
 * Bengali text is actually painted, which an English store never does.
 */
const bengali = Noto_Sans_Bengali({
  variable: '--font-bengali-family',
  subsets: ['bengali'],
  display: 'swap',
  preload: false,
});

const FONT_VARIABLES = `${sans.variable} ${display.variable} ${technical.variable} ${bengali.variable}`;

/**
 * Metadata is per store, so it is generated rather than static — one deployment
 * serves many brands and none of them should share a title.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  const title = config.seo.title ?? config.store.name;
  const description = config.seo.description ?? config.store.tagline ?? undefined;
  const trading = isStoreTrading(config.status);

  return {
    metadataBase: new URL(config.store.canonicalOrigin),
    title: { default: title, template: `%s · ${config.store.name}` },
    description,
    applicationName: config.store.name,
    // A closed store must not accumulate indexed pages while it is closed.
    ...(trading ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      type: 'website',
      siteName: config.store.name,
      title,
      description,
      url: config.store.canonicalOrigin,
      ...(config.seo.socialImageUrl ? { images: [config.seo.socialImageUrl] } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
    ...(config.store.faviconUrl ? { icons: { icon: config.store.faviconUrl } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const config = await getStoreConfig();
  const theme = resolveTheme(config.design.colorThemeKey);

  /*
   * Which layout a phone gets is decided here, in the viewport meta tag, and
   * nowhere else.
   *
   * `desktop` hands the phone a fixed 1280px layout viewport. Every media query
   * in the stylesheet then matches as it would on a monitor — the sidebar
   * stays, the category row stays eight across, the product grid stays six
   * across — and the browser scales the whole thing down to the screen. CSS
   * cannot produce this: breakpoints answer to the layout viewport, so the only
   * way to keep the desktop layout is to keep the desktop viewport.
   *
   * Zoom is deliberately left enabled. At this scale pinch-zoom is how anyone
   * actually reads the page, and `maximum-scale` or `user-scalable=no` would
   * take that away — which is both an accessibility failure and, here, a
   * usability one.
   */
  const desktopOnMobile = publicConfig.mobileLayout === 'desktop';

  return {
    ...(desktopOnMobile
      ? {
          width: DESKTOP_LAYOUT_WIDTH,
          /*
           * Explicitly cleared, not merely omitted. Next merges what this
           * function returns over a default of `{ width: 'device-width',
           * initialScale: 1 }`, so leaving it out keeps `initial-scale=1` —
           * which pins the zoom at 1:1 and gives a phone a 1280px page it has
           * to scroll sideways through. Dropping it is what lets the browser
           * pick the scale that fits 1280px into the screen it has.
           */
          initialScale: undefined,
        }
      : { width: 'device-width', initialScale: 1 }),
    // Matches the store's own background, so the browser chrome does not flash
    // white on a tinted theme.
    themeColor: theme.tokens.background,
  };
}

/**
 * Marks the document as being read on a phone-sized screen.
 *
 * Only `desktop` mobile mode renders it, and only that mode needs it: the layout
 * viewport there is 1280px on a phone as well as on a monitor, so every width
 * media query answers the same on both and CSS on its own cannot tell them
 * apart. `screen` describes the device rather than the viewport, so it can — and
 * the short edge is what is read, so turning the phone does not change the
 * answer.
 *
 * Inline and synchronous in `<head>`, for the reason `ThemeStyle` is: it runs
 * before the first paint, so a product rail is a rail in the first frame instead
 * of a six-across grid that reflows once React arrives. That also rules out an
 * effect, and is why the attribute goes on `documentElement` — outside the tree
 * React hydrates, so setting it can never be a hydration mismatch.
 *
 * With JavaScript off nothing is marked and the phone keeps the plain desktop
 * grid, which is exactly what this mode did before the rails existed.
 */
function PhoneScreenFlag() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{if(Math.min(screen.width,screen.height)<=${PHONE_SCREEN_MAX_WIDTH})document.documentElement.setAttribute('data-phone-layout','')}catch(e){}`,
      }}
    />
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await getStoreConfig();
  const template = await getTemplate(config.design.templateKey);
  const locale = await readLocalePreference(config);
  // The language the shop is drawn in, and the dictionary its client components
  // need for it — `null` for English, which ships none.
  const [language, messages, t] = await Promise.all([getLanguage(), getMessages(), getT()]);

  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        {/* Painted before any content, so the first frame is already on-brand. */}
        <ThemeStyle themeKey={config.design.colorThemeKey} />
        {publicConfig.mobileLayout === 'desktop' ? <PhoneScreenFlag /> : null}
      </head>
      <body className={`${FONT_VARIABLES} ${template.bodyClassName} antialiased`}>
        <I18nProvider language={language} messages={messages}>
        <StorefrontProviders>
        {/*
          The gate wraps the template rather than the other way round. Header,
          footer and chrome are all inside it, so a suspended store cannot
          serve a working nav bar because one template forgot to check.
        */}
        <StoreGate config={config}>
          {/* Keyboard users should not have to tab through the whole header. */}
          <a
            href="#main"
            className="sr-only-focusable absolute left-4 top-4 z-50 rounded-(--radius-button) bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t('Skip to content')}
          </a>

          <template.Header config={config} locale={locale} />
          <main id="main" className="min-h-[50vh] pb-4">
            {children}
          </main>
          <template.Footer config={config} locale={locale} />

          {/*
            Mounted here rather than by each template, so a template cannot
            declare it wants a bottom bar and then forget to render one — which
            is exactly what the `mobileBottomNav` flag did until now.
          */}
          {template.mobileBottomNav && config.mobileNav.length > 0 ? (
            <>
              <MobileBottomNavSpacer />
              <MobileBottomNav items={config.mobileNav} />
            </>
          ) : null}
        </StoreGate>

        <CartCurrencySync currency={config.store.currency} />
        <BackToTop enabled={template.preset.showBackToTop} offset={template.mobileBottomNav} />
        <WhatsAppButton contact={config.contact} offset={template.mobileBottomNav} />
        <DesignSwitcherMount />
        </StorefrontProviders>
        </I18nProvider>
      </body>
    </html>
  );
}
