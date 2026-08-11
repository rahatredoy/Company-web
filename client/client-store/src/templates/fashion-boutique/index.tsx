import Link from 'next/link';
import { Headphones, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import type { StoreConfig } from '@/types';
import type { StorefrontTemplate, TemplateChromeProps, TemplateHomepageProps, TemplatePreset } from '../registry';
import { StoreLogo } from '../chrome';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { HeaderActions } from '@/components/layout/header-actions';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SearchBox } from '@/components/layout/search-box';
import { MegaMenu } from '@/components/layout/mega-menu';
import { CategoryMenuButton } from '@/components/layout/category-menu-button';
import { SiteFooter } from '@/components/layout/site-footer';
import { HomepageSections } from '@/sections/section-renderer';
import { cn } from '@/lib/utils';

/**
 * Fashion Boutique — editorial, photographic, collection-led.
 *
 * Serif headings, portrait product imagery, generous vertical rhythm and a
 * lookbook. Square corners throughout (`template-editorial` zeroes the radii),
 * because rounded cards read as software and this template is trying to read as
 * a magazine.
 *
 * This is the template that was silently rendering in the body sans until the
 * `--font-display` self-reference in `globals.css` was fixed — the serif is the
 * whole point of it.
 */

const preset: TemplatePreset = {
  heroVariant: 'editorial',
  categoryStyle: 'card',
  benefitsTone: 'bordered',
  productSectionMode: 'carousel',
  carouselPerView: { base: 2, sm: 3, lg: 4, xl: 6 },
  brandStripTone: 'cream',
  imageRatio: 'portrait',
  showUtilityBar: false,
  showCategorySidebar: true,
  showLookbook: true,
  showBackToTop: true,
  megaMenu: 'columns-promo',
  sectionRhythm: 'airy',
};

/**
 * The trust strip sits in the header rather than below the hero here.
 *
 * An editorial hero wants the full width of the screen with nothing
 * interrupting it, so the four service claims move above the fold instead — the
 * same four claims, from the same place, in a different slot.
 */
const HEADER_BENEFITS = [
  { icon: Truck, title: 'Free Shipping', description: 'On orders over $100' },
  { icon: RotateCcw, title: '30 Days Returns', description: 'Money back guarantee' },
  { icon: ShieldCheck, title: 'Secure Payment', description: '100% protected checkout' },
  { icon: Headphones, title: 'Customer Support', description: '24/7 live support' },
];

function Header({ config }: TemplateChromeProps) {
  return (
    <header className="sticky top-0 z-40 bg-surface shadow-[var(--shadow-header)]">
      <AnnouncementBar announcement={config.announcement} />

      <div className="container-store flex h-[4.5rem] items-center gap-5">
        <MobileNav config={config} />
        <StoreLogo config={config} serif priority />

        <MegaMenu
          config={config}
          style={preset.megaMenu}
          className="flex-1 justify-center"
          linkClassName="uppercase tracking-[0.08em] text-[13px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <SearchBox
            variant="inline"
            className="hidden w-56 xl:block"
            placeholder="Search for products…"
          />
          <SearchBox variant="icon" className="hidden lg:block xl:hidden" />
          <HeaderActions />
        </div>
      </div>

      <div className="container-store pb-3 lg:hidden">
        <SearchBox variant="inline" />
      </div>
    </header>
  );
}

/** The dark category button beside the service claims, under the header. */
function BrowseStrip({ config }: { config: StoreConfig }) {
  return (
    <div className="container-store pt-4">
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <CategoryMenuButton config={config} tone="dark" className="hidden w-full lg:inline-flex" />

        <ul className="grid grid-cols-2 divide-border border border-border bg-surface sm:grid-cols-4 sm:divide-x">
          {HEADER_BENEFITS.map((benefit) => (
            <li key={benefit.title} className="flex items-center gap-2.5 px-4 py-3">
              <benefit.icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{benefit.title}</span>
                <span className="block truncate text-[11px] text-muted">{benefit.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Footer({ config, locale }: TemplateChromeProps) {
  return <SiteFooter config={config} locale={locale} tone="dark" serif />;
}

function Homepage({ config, sections, locale }: TemplateHomepageProps) {
  const context = { config, cardVariant: 'editorial' as const, gridClassName: GRID, preset };

  /*
   * The benefits section is rendered in the browse strip above, so it is
   * dropped from the flow to avoid showing the same four claims twice.
   */
  const flow = sections.filter(
    (section) => section.type !== 'benefits' && section.config.variant !== 'benefits',
  );

  return (
    <>
      <BrowseStrip config={config} />
      <HomepageSections sections={flow} context={context} />

      <div className={cn('container-store pt-16 text-center')}>
        <p className="text-sm text-muted">
          Every piece chosen by hand.{' '}
          <Link href="/about" className="font-medium text-primary hover:underline">
            Read our story
          </Link>
        </p>
      </div>
    </>
  );
}

const GRID = 'grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

const template: StorefrontTemplate = {
  key: 'fashion_boutique',
  name: 'Fashion Boutique',
  description: 'Editorial photography and elegant type, built for apparel.',
  Header,
  Footer,
  Homepage,
  cardVariant: 'editorial',
  gridClassName: GRID,
  mobileBottomNav: false,
  bodyClassName: 'template-editorial',
  preset,
};

export default template;
