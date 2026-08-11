import Link from 'next/link';
import { GitCompareArrows } from 'lucide-react';
import type { StorefrontTemplate, TemplateChromeProps, TemplateHomepageProps, TemplatePreset } from '../registry';
import { StoreLogo } from '../chrome';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { UtilityBar } from '@/components/layout/utility-bar';
import { HeaderActions } from '@/components/layout/header-actions';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SearchBox } from '@/components/layout/search-box';
import { CategorySidebar } from '@/components/layout/category-sidebar';
import { SiteFooter } from '@/components/layout/site-footer';
import { HomepageSections } from '@/sections/section-renderer';

/**
 * Electronics — technical and scannable.
 *
 * Search dominates the header because shoppers arrive knowing a model number,
 * not a mood. Cards use the `spec` presentation: a key specification line and an
 * explicit stock state, because "which of these two is actually in stock, and
 * what is the battery life" is the real question on a tech listing.
 *
 * The only template using the technical heading face, set through a second body
 * class alongside the radius class.
 */

const preset: TemplatePreset = {
  heroVariant: 'tech',
  categoryStyle: 'compact',
  benefitsTone: 'dark',
  productSectionMode: 'carousel',
  carouselPerView: { base: 2, sm: 3, lg: 5, xl: 6 },
  brandStripTone: 'plain',
  imageRatio: 'square',
  showUtilityBar: true,
  showCategorySidebar: true,
  showLookbook: false,
  showBackToTop: true,
  megaMenu: 'columns-promo',
  sectionRhythm: 'tight',
};

function Header({ config, locale }: TemplateChromeProps) {
  return (
    <header className="sticky top-0 z-40 bg-surface shadow-[var(--shadow-header)]">
      <AnnouncementBar announcement={config.announcement} />
      <UtilityBar config={config} locale={locale} />

      <div className="container-store flex h-16 items-center gap-3">
        <MobileNav config={config} />
        <StoreLogo config={config} priority />

        {/* Widest search field of any template — deliberately. */}
        <div className="hidden max-w-3xl flex-1 lg:ml-8 lg:block">
          <SearchBox variant="inline" placeholder="Search by model, brand or spec…" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/compare"
            className="hidden items-center gap-1.5 rounded-(--radius-button) border border-border-strong px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-alt lg:inline-flex"
          >
            <GitCompareArrows className="size-4" aria-hidden />
            Compare
          </Link>
          <SearchBox variant="icon" className="lg:hidden" />
          <HeaderActions />
        </div>
      </div>

      {/* A flat category rail rather than a dropdown: on a tech catalogue the
          departments are the navigation. */}
      <div className="hidden border-t border-border lg:block">
        <div className="container-store">
          <nav aria-label="Categories">
            <ul className="no-scrollbar flex items-center gap-6 overflow-x-auto py-2.5">
              {config.categoryMenu.map((category) => (
                <li key={category.id} className="shrink-0">
                  <Link
                    href={`/category/${category.slug}`}
                    className="text-sm font-medium text-muted transition-colors hover:text-primary"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      <div className="container-store pb-3 lg:hidden">
        <SearchBox variant="inline" />
      </div>
    </header>
  );
}

function Footer({ config, locale }: TemplateChromeProps) {
  return <SiteFooter config={config} locale={locale} tone="surface" className="mt-14" />;
}

function Homepage({ config, sections, locale }: TemplateHomepageProps) {
  const heroIndex = sections.findIndex((section) => section.type === 'hero');
  const hero = heroIndex === -1 ? null : sections[heroIndex]!;
  const rest = sections.filter((_, index) => index !== heroIndex);
  const context = { config, cardVariant: 'spec' as const, gridClassName: GRID, preset };

  return (
    <>
      {hero ? (
        <div className="container-store pt-4">
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <CategorySidebar config={config} title="Shop by Category" headerTone="dark" />
            {/*
              The hero is full-bleed in this template, so inside the split it
              needs its own shell padding cancelled — one override, on one
              wrapper, rather than a selector reaching through descendants.
            */}
            <div className="min-w-0 [&>section]:!pt-0 [&_.container-store]:!mx-0 [&_.container-store]:!max-w-none [&_.container-store]:!px-0">
              <HomepageSections sections={[hero]} context={context} />
            </div>
          </div>
        </div>
      ) : null}

      <HomepageSections sections={rest} context={context} />
    </>
  );
}

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

const template: StorefrontTemplate = {
  key: 'electronics',
  name: 'Electronics',
  description: 'Spec-forward cards, deals and comparison for tech.',
  Header,
  Footer,
  Homepage,
  cardVariant: 'spec',
  gridClassName: GRID,
  mobileBottomNav: true,
  // Two classes: the radius scale, and the technical heading face.
  bodyClassName: 'template-dense template-technical',
  preset,
};

export default template;
