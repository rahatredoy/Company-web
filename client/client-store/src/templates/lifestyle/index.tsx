import Link from 'next/link';
import type { StorefrontTemplate, TemplateChromeProps, TemplateHomepageProps, TemplatePreset } from '../registry';
import { TEMPLATE_META } from '../meta';
import { StoreLogo } from '../chrome';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { HeaderActions } from '@/components/layout/header-actions';
import { MobileNav } from '@/components/layout/mobile-nav';
import { BackButton } from '@/components/layout/back-button';
import { SearchBox } from '@/components/layout/search-box';
import { SiteFooter } from '@/components/layout/site-footer';
import { HomepageSections } from '@/sections/section-renderer';
import { getT } from '@/lib/i18n/server';

/**
 * Lifestyle — warm and editorial, for home, decor and furniture.
 *
 * Landscape imagery rather than square, because a sofa or a room set reads
 * badly in a 1:1 crop. Navigation sits beside the logo on one relaxed line, the
 * grid tops out at four columns, and the rhythm is airy enough that the page
 * reads as a magazine spread rather than a catalogue.
 */

const preset: TemplatePreset = {
  heroVariant: 'split',
  categoryStyle: 'editorial',
  benefitsTone: 'plain',
  productSectionMode: 'carousel',
  carouselPerView: { base: 2, sm: 2, lg: 3, xl: 4 },
  brandStripTone: 'plain',
  imageRatio: 'landscape',
  showUtilityBar: false,
  showCategorySidebar: false,
  showLookbook: true,
  showBackToTop: true,
  megaMenu: 'none',
  sectionRhythm: 'airy',
};

async function Header({ config }: TemplateChromeProps) {
  const t = await getT();

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-sm">
      <AnnouncementBar announcement={config.announcement} />

      <div className="container-store flex h-[4.5rem] items-center gap-6 border-b border-border">
        <MobileNav config={config} />
        <BackButton />
        <StoreLogo config={config} priority />

        <nav aria-label={t('Main')} className="hidden lg:block">
          <ul className="flex items-center gap-8">
            {config.navigation.header.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  target={item.opensInNewTab ? '_blank' : undefined}
                  rel={item.opensInNewTab ? 'noreferrer noopener' : undefined}
                  className="text-sm text-foreground transition-colors hover:text-primary"
                >
                  {t.loose(item.label)}
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

      <div className="container-store py-3 lg:hidden">
        <SearchBox variant="inline" />
      </div>
    </header>
  );
}

function Footer({ config, locale }: TemplateChromeProps) {
  return <SiteFooter config={config} locale={locale} tone="alt" className="mt-20" />;
}

function Homepage({ config, sections }: TemplateHomepageProps) {
  return (
    <HomepageSections
      sections={sections}
      context={{ config, cardVariant: 'wide', gridClassName: GRID, preset }}
    />
  );
}

const GRID = 'product-grid grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

const template: StorefrontTemplate = {
  key: 'lifestyle',
  name: 'Lifestyle',
  description: TEMPLATE_META.lifestyle.description,
  Header,
  Footer,
  Homepage,
  cardVariant: 'wide',
  gridClassName: GRID,
  mobileBottomNav: false,
  bodyClassName: 'template-soft',
  preset,
};

export default template;
