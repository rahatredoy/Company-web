import Link from 'next/link';
import type { StorefrontTemplate, TemplateChromeProps, TemplateHomepageProps, TemplatePreset } from '../registry';
import { StoreLogo } from '../chrome';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { HeaderActions } from '@/components/layout/header-actions';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SearchBox } from '@/components/layout/search-box';
import { SiteFooter } from '@/components/layout/site-footer';
import { HomepageSections } from '@/sections/section-renderer';

/**
 * Minimal Store — restraint as the design.
 *
 * Logo left, four links, no coloured blocks competing for attention, no card
 * borders, and a grid that never exceeds three columns so every product gets a
 * genuinely large portrait image. For a curated catalogue, showing fewer things
 * larger sells better than showing everything.
 *
 * The only template that renders product sections as a **grid** rather than a
 * rail: a scrolling carousel implies there is more just off-screen, which is the
 * opposite of what a short, deliberate range is saying.
 */

const preset: TemplatePreset = {
  heroVariant: 'fullbleed',
  categoryStyle: 'editorial',
  benefitsTone: 'plain',
  productSectionMode: 'grid',
  carouselPerView: { base: 1, sm: 2, lg: 3, xl: 3 },
  brandStripTone: 'plain',
  imageRatio: 'portrait',
  showUtilityBar: false,
  showCategorySidebar: false,
  showLookbook: false,
  showBackToTop: false,
  megaMenu: 'none',
  sectionRhythm: 'airy',
};

function Header({ config }: TemplateChromeProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <AnnouncementBar announcement={config.announcement} />

      <div className="container-store flex h-[4.5rem] items-center gap-4">
        <MobileNav config={config} />
        <StoreLogo config={config} priority />

        {/* Only the first few links — a minimal header listing everything is not
            a minimal header. */}
        <nav aria-label="Main" className="ml-10 hidden lg:block">
          <ul className="flex items-center gap-8">
            {config.navigation.header.slice(0, 4).map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="text-sm text-muted transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <SearchBox variant="icon" className="hidden lg:block" />
          <HeaderActions locale={config.store.language} />
        </div>
      </div>
    </header>
  );
}

function Footer({ config, locale }: TemplateChromeProps) {
  return <SiteFooter config={config} locale={locale} tone="surface" className="mt-24" />;
}

function Homepage({ config, sections }: TemplateHomepageProps) {
  /*
   * Minimal means fewer sections, not smaller ones. The trust strip, the brand
   * rail and the promo trio are dropped: they are merchandising furniture, and
   * they work directly against the restraint this template is chosen for.
   */
  const kept = sections.filter((section) => {
    if (section.type === 'brands' || section.type === 'promo_trio') return false;
    if (section.type === 'benefits') return false;
    if (section.type === 'text' && section.config.variant === 'benefits') return false;
    return true;
  });

  return (
    <HomepageSections
      sections={kept}
      context={{ config, cardVariant: 'standard', gridClassName: GRID, preset }}
    />
  );
}

const GRID = 'grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3';

const template: StorefrontTemplate = {
  key: 'minimal_store',
  name: 'Minimal Store',
  description: 'Restrained and premium, for small curated catalogues.',
  Header,
  Footer,
  Homepage,
  cardVariant: 'standard',
  gridClassName: GRID,
  mobileBottomNav: false,
  bodyClassName: 'template-editorial',
  preset,
};

export default template;
