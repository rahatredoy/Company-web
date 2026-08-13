import type { StorefrontTemplate, TemplateChromeProps, TemplateHomepageProps, TemplatePreset } from '../registry';
import { StoreLogo } from '../chrome';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { UtilityBar } from '@/components/layout/utility-bar';
import { HeaderActions } from '@/components/layout/header-actions';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SearchBox } from '@/components/layout/search-box';
import { MegaMenu } from '@/components/layout/mega-menu';
import { CategorySidebar } from '@/components/layout/category-sidebar';
import { SiteFooter } from '@/components/layout/site-footer';
import { HomepageSections } from '@/sections/section-renderer';

/**
 * Marketplace — dense, promotional, search-led.
 *
 * Built for a catalogue too broad to browse: a permanent category rail beside
 * the hero, circular department icons, a live deal beside campaign panels, and
 * six products across at desktop width. Everything is tuned for "find the thing
 * and see the price", not for dwelling on photography.
 *
 * Composition and styling only — the same product card, the same sections and
 * the same header controls as every other template.
 */

const preset: TemplatePreset = {
  heroVariant: 'panel',
  categoryStyle: 'circle',
  benefitsTone: 'tinted',
  productSectionMode: 'carousel',
  carouselPerView: { base: 2, sm: 3, lg: 5, xl: 6 },
  brandStripTone: 'tinted',
  imageRatio: 'square',
  showUtilityBar: true,
  showCategorySidebar: true,
  showLookbook: false,
  showBackToTop: true,
  megaMenu: 'columns',
  sectionRhythm: 'tight',
};

/**
 * Two tiers: identity and search on top, navigation beneath.
 *
 * A marketplace's search box is its primary control, so it gets the middle of
 * the widest row rather than being folded behind an icon.
 */
function Header({ config, locale }: TemplateChromeProps) {
  return (
    <header className="sticky top-0 z-40 bg-surface shadow-[var(--shadow-header)]">
      <AnnouncementBar announcement={config.announcement} />
      <UtilityBar config={config} locale={locale} />

      <div className="container-store flex h-16 items-center gap-4">
        <MobileNav config={config} />
        <StoreLogo config={config} priority />

        <SearchBox variant="inline" className="mx-auto hidden max-w-2xl flex-1 lg:block" />

        <div className="ml-auto flex items-center gap-1">
          <SearchBox variant="icon" className="lg:hidden" />
          <HeaderActions />
        </div>
      </div>

      <div className="hidden border-t border-border lg:block">
        <div className="container-store flex h-11 items-center">
          <MegaMenu config={config} style={preset.megaMenu} />
        </div>
      </div>

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
  const heroIndex = sections.findIndex((section) => section.type === 'hero');
  const hero = heroIndex === -1 ? null : sections[heroIndex]!;
  const rest = sections.filter((_, index) => index !== heroIndex);
  const context = { config, cardVariant: 'compact' as const, gridClassName: GRID, preset };

  return (
    <>
      {hero ? (
        <div className="container-store pt-4">
          <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <CategorySidebar config={config} headerTone="primary" />
            {/* The hero brings its own shell padding; inside the split it must not. */}
            <div className="min-w-0 [&>section]:!pt-0">
              <HomepageSections sections={[hero]} context={context} />
            </div>
          </div>
        </div>
      ) : null}

      <HomepageSections sections={rest} context={context} />
    </>
  );
}

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6';

const template: StorefrontTemplate = {
  key: 'marketplace',
  name: 'Marketplace',
  description: 'Dense, search-led layout for large multi-category catalogues.',
  Header,
  Footer,
  Homepage,
  cardVariant: 'compact',
  gridClassName: GRID,
  mobileBottomNav: true,
  bodyClassName: 'template-dense',
  preset,
};

export default template;
