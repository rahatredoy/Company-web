import { ShieldCheck } from 'lucide-react';
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
import { BENEFIT_ICONS } from '@/components/sections/benefits-strip';
import { HomepageSections } from '@/sections/section-renderer';
import { readBenefits, type BenefitItem } from '@/sections/parse';
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
          <HeaderActions locale={config.store.language} />
        </div>
      </div>

      <div className="container-store pb-3 lg:hidden">
        <SearchBox variant="inline" />
      </div>
    </header>
  );
}

/** The dark category button beside the service claims, under the header. */
/**
 * Category button and the store's service claims, above the fold.
 *
 * An editorial hero wants the full width of the screen with nothing
 * interrupting it, so the trust strip moves above it rather than sitting below
 * as it does in the other templates. Same claims, different slot.
 *
 * The claims used to be four constants declared in this file — "Free Shipping /
 * On orders over $100" and three more — rendered on every fashion store on the
 * platform whatever its actual shipping threshold or currency, while the
 * store's own `benefits` section was filtered out of the flow to stop them
 * appearing twice. So a store that had written real claims had them silently
 * replaced by invented ones. Now the strip renders the store's own section, and
 * a store with none gets a category button and nothing else.
 */
function BrowseStrip({ config, benefits }: { config: StoreConfig; benefits: BenefitItem[] }) {
  return (
    <div className="container-store pt-4">
      <div className={cn('grid gap-4', benefits.length > 0 && 'lg:grid-cols-[15rem_minmax(0,1fr)]')}>
        <CategoryMenuButton config={config} tone="dark" className="hidden w-full lg:inline-flex" />

        {benefits.length > 0 ? (
          <ul className="grid grid-cols-2 divide-border border border-border bg-surface sm:grid-cols-4 sm:divide-x">
            {benefits.slice(0, 4).map((benefit, index) => {
              const Icon = BENEFIT_ICONS[benefit.icon ?? ''] ?? ShieldCheck;

              return (
                <li key={`${benefit.title}-${index}`} className="flex items-center gap-2.5 px-4 py-3">
                  <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{benefit.title}</span>
                    {benefit.description ? (
                      <span className="block truncate text-[11px] text-muted">{benefit.description}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Footer({ config, locale }: TemplateChromeProps) {
  return <SiteFooter config={config} locale={locale} tone="dark" serif />;
}

function Homepage({ config, sections }: TemplateHomepageProps) {
  const context = { config, cardVariant: 'editorial' as const, gridClassName: GRID, preset };

  // The benefits section is lifted into the browse strip above, so it is
  // dropped from the flow rather than rendered twice.
  const isBenefits = (section: (typeof sections)[number]) =>
    section.type === 'benefits' || section.config.variant === 'benefits';

  const benefits = sections.filter(isBenefits).flatMap((section) => readBenefits(section.config.items));
  const flow = sections.filter((section) => !isBenefits(section));

  return (
    <>
      <BrowseStrip config={config} benefits={benefits} />
      <HomepageSections sections={flow} context={context} />
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
