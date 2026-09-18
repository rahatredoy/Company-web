import type { StorefrontTemplate, TemplateChromeProps, TemplateHomepageProps, TemplatePreset } from '../registry';
import { TEMPLATE_META } from '../meta';
import { StoreLogo } from '../chrome';
import { HeaderActions } from '@/components/layout/header-actions';
import { MobileNav } from '@/components/layout/mobile-nav';
import { BackButton } from '@/components/layout/back-button';
import { SearchBox } from '@/components/layout/search-box';
import { MegaMenu, type NavFlag } from '@/components/layout/mega-menu';
import { CategorySidebar } from '@/components/layout/category-sidebar';
import { LocaleSelects } from '@/components/layout/locale-selects';
import { SiteFooter } from '@/components/layout/site-footer';
import { HomepageSections } from '@/sections/section-renderer';
import { getT } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n';

/**
 * Modern Shop — the default template.
 *
 * Rounded, spacious and friendly: a soft gradient hero beside a category rail,
 * circular category icons, tinted promo cards, and a four-to-six across product
 * grid. It errs towards familiar rather than distinctive, because it is the one
 * most stores will land on without choosing.
 *
 * Like every template it owns composition and styling only. The header renders
 * the same `SearchBox` and `HeaderActions` as the other five; the homepage
 * renders the same `HomepageSections`. No commerce logic lives in this file —
 * six copies of a price would be six places for a pricing bug to hide.
 */

const preset: TemplatePreset = {
  heroVariant: 'gradient',
  categoryStyle: 'circle',
  benefitsTone: 'tinted',
  productSectionMode: 'carousel',
  carouselPerView: { base: 2, sm: 3, lg: 5, xl: 6 },
  brandStripTone: 'tinted',
  imageRatio: 'square',
  showUtilityBar: false,
  showCategorySidebar: true,
  showLookbook: false,
  showBackToTop: true,
  megaMenu: 'columns',
  sectionRhythm: 'normal',
};

/** Nav pips, keyed by destination so a renamed or translated menu keeps them. */
const NAV_FLAGS: Record<string, { label: MessageKey; tone: NavFlag['tone'] }> = {
  '/new-arrivals': { label: 'New', tone: 'primary' },
  '/sale': { label: 'Hot', tone: 'sale' },
};

async function Header({ config, locale }: TemplateChromeProps) {
  const t = await getT();
  const flags: Record<string, NavFlag> = Object.fromEntries(
    Object.entries(NAV_FLAGS).map(([href, flag]) => [href, { ...flag, label: t(flag.label) }]),
  );

  return (
    <header className="sticky top-0 z-40 bg-surface shadow-[var(--shadow-header)]">
      <div className="container-store flex h-16 items-center gap-4">
        <MobileNav config={config} />
        <BackButton />
        <StoreLogo config={config} priority />

        <MegaMenu
          config={config}
          style={preset.megaMenu}
          flags={flags}
          className="flex-1 justify-center"
        />

        <div className="ml-auto flex items-center gap-2">
          <SearchBox variant="inline" className="hidden w-64 xl:block" />
          <SearchBox variant="icon" className="hidden lg:block xl:hidden" />
          {/* Renders nothing at all unless the store offers a second language or
              currency, which is why it can sit in the action row unconditionally. */}
          <LocaleSelects
            languages={config.store.languages}
            currencies={config.store.currencies}
            language={locale.language}
            currency={locale.currency}
            tone="muted"
            className="hidden lg:flex"
          />
          <HeaderActions locale={config.store.language} />
        </div>
      </div>

      {/* Search stays reachable on small screens without opening the drawer. */}
      <div className="container-store pb-3 lg:hidden">
        <SearchBox variant="inline" />
      </div>
    </header>
  );
}

function Footer({ config, locale }: TemplateChromeProps) {
  return <SiteFooter config={config} locale={locale} tone="surface" />;
}

function Homepage({ config, sections }: TemplateHomepageProps) {
  const [hero, ...rest] = splitHero(sections);

  return (
    <>
      {/*
        The category rail sits beside the hero rather than above it, so the
        catalogue's shape is visible in the first screen without pushing the
        campaign below the fold.
      */}
      {hero ? (
        <div className="container-store pt-4 sm:pt-6">
          <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
            {/* Every department, in a rail the height of the hero beside it — the
                list scrolls rather than stopping short of the catalogue. */}
            <CategorySidebar config={config} />
            <div className="min-w-0 [&>section]:!pt-0">
              <HomepageSections
                sections={[hero]}
                context={{ config, cardVariant: 'standard', gridClassName: GRID, preset }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <HomepageSections
        sections={rest}
        context={{ config, cardVariant: 'standard', gridClassName: GRID, preset }}
      />

    </>
  );
}

/** Pulls the hero out so it can be laid out beside the category rail. */
function splitHero(sections: TemplateHomepageProps['sections']) {
  const index = sections.findIndex((section) => section.type === 'hero');
  if (index === -1) return [null, ...sections] as const;
  return [sections[index]!, ...sections.filter((_, position) => position !== index)] as const;
}

const GRID = 'product-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

const template: StorefrontTemplate = {
  key: 'modern_shop',
  name: 'Modern Shop',
  description: TEMPLATE_META.modern_shop.description,
  Header,
  Footer,
  Homepage,
  cardVariant: 'standard',
  gridClassName: GRID,
  mobileBottomNav: true,
  bodyClassName: 'template-soft',
  preset,
};

export default template;
