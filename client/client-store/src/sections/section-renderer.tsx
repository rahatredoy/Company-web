import type { HomepageSection, StoreConfig } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { getBrands, getCategories, getProductsByIds } from '@/lib/api/catalog';
import { SectionHeading, SectionShell } from '@/components/sections/section-shell';
import { HeroCarousel } from '@/components/sections/hero-carousel';
import { CategoryCircles } from '@/components/sections/category-circles';
import { CategoryCards } from '@/components/sections/category-cards';
import { BenefitsStrip } from '@/components/sections/benefits-strip';
import { PromoBannerGrid } from '@/components/sections/promo-banner-grid';
import { PromoMosaic } from '@/components/sections/promo-mosaic';
import { DealOfTheDay } from '@/components/sections/deal-of-the-day';
import { FlashSaleRail } from '@/components/sections/flash-sale-rail';
import { ProductTabCarousel } from '@/components/sections/product-tab-carousel';
import { BrandStrip } from '@/components/sections/brand-strip';
import { Lookbook } from '@/components/sections/lookbook';
import { Testimonials } from '@/components/sections/testimonials';
import { NewsletterBand } from '@/components/sections/newsletter-band';
import {
  readBanners,
  readBenefits,
  readDeadline,
  readLookbookTiles,
  readNumber,
  readString,
  readStringArray,
  readSlides,
  readTabs,
  readTestimonials,
  readVariant,
} from './parse';

/**
 * Everything a section needs to know about the template it is rendering into.
 *
 * `preset` is the important part: it is how one set of section components
 * produces six visibly different homepages. A section asks the preset how dense
 * the rail should be or whether categories are circles; it never asks which
 * template it is in, because that would put a `switch (templateKey)` inside
 * shared code and undo the whole arrangement.
 */
export interface SectionContext {
  config: StoreConfig;
  cardVariant: ProductCardVariant;
  gridClassName: string;
  preset: TemplatePreset;
}

/**
 * Renders one store-configured homepage section.
 *
 * `type` is a closed set and an unrecognised value is **skipped silently**
 * rather than rendered: an unknown string in that column is a data problem, and
 * turning it into markup is how a compromised admin panel becomes a scripted
 * page.
 */
export async function SectionRenderer({
  section,
  context,
  index,
}: {
  section: HomepageSection;
  context: SectionContext;
  index: number;
}) {
  // Only the first section above the fold gets image priority; everything else
  // lazy-loads, which is what keeps LCP honest.
  const isFirst = index === 0;
  const { preset, config } = context;
  const rhythm = preset.sectionRhythm;
  const variant = readVariant(section);

  switch (section.type) {
    case 'hero': {
      const slides = readSlides(section);
      if (slides.length === 0) return null;

      return (
        <SectionShell
          rhythm="tight"
          bleed={preset.heroVariant === 'fullbleed' || preset.heroVariant === 'tech'}
          label="Featured"
          className={isFirst ? 'pt-4 sm:pt-6' : undefined}
        >
          <HeroCarousel slides={slides} variant={preset.heroVariant} priority={isFirst} />
        </SectionShell>
      );
    }

    case 'category_circle':
      return <CategorySection section={section} context={context} style="circle" />;

    case 'category_grid':
      return <CategorySection section={section} context={context} style={preset.categoryStyle} />;

    case 'benefits':
      return <BenefitsBlock section={section} rhythm={rhythm} tone={preset.benefitsTone} />;

    case 'product_grid':
    case 'product_carousel':
      return <ProductSection section={section} context={context} />;

    case 'promo_trio': {
      const banners = readBanners(section.config.banners);
      if (banners.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading title={section.title} subtitle={section.subtitle} />
          <PromoBannerGrid banners={banners} columns={3} ratio="panel" />
        </SectionShell>
      );
    }

    case 'deal':
      return <DealSection section={section} context={context} />;

    case 'banner': {
      // Sections saved before `deal` and `promo_trio` were types of their own
      // still carry the discriminator in `config.variant`.
      if (variant === 'deal') return <DealSection section={section} context={context} />;

      const banners = readBanners(section.config.banners);
      if (banners.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading title={section.title} subtitle={section.subtitle} />
          <PromoBannerGrid banners={banners} />
        </SectionShell>
      );
    }

    case 'flash_sale': {
      const products = await getProductsByIds(readStringArray(section.config.productIds));
      if (products.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <FlashSaleRail
            title={section.title ?? 'Flash Deals'}
            subtitle={section.subtitle}
            deadline={readDeadline(section.config)}
            products={products}
            perView={preset.carouselPerView}
            cardVariant={context.cardVariant}
            locale={config.store.language}
          />
        </SectionShell>
      );
    }

    case 'brands': {
      const brands = await getBrands();
      if (brands.length === 0) return null;

      const tinted = preset.brandStripTone === 'tinted';

      return (
        <SectionShell rhythm={rhythm}>
          <div
            className={
              tinted ? 'rounded-(--radius-card) bg-surface-alt p-5 sm:p-6' : undefined
            }
          >
            <SectionHeading
              title={section.title ?? 'Top Brands'}
              size="sm"
              action={{ label: 'View all', href: '/brands' }}
            />
            <BrandStrip brands={brands} tone={preset.brandStripTone} />
          </div>
        </SectionShell>
      );
    }

    case 'lookbook': {
      const tiles = readLookbookTiles(section.config.tiles);
      if (tiles.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <Lookbook
            title={section.title ?? 'Lookbook'}
            subtitle={section.subtitle}
            ctaLabel={readString(section.config.ctaLabel) ?? 'View Lookbook'}
            ctaHref={readString(section.config.ctaHref) ?? '/shop'}
            tiles={tiles}
          />
        </SectionShell>
      );
    }

    case 'testimonial': {
      const testimonials = readTestimonials(section.config.items);
      if (testimonials.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading
            title={section.title ?? 'What our customers say'}
            subtitle={section.subtitle}
            align="center"
            rule
          />
          <Testimonials testimonials={testimonials} />
        </SectionShell>
      );
    }

    case 'newsletter':
      return (
        <SectionShell rhythm={rhythm}>
          <NewsletterBand
            title={section.title ?? 'Subscribe to our newsletter'}
            subtitle={section.subtitle}
            tone={preset.benefitsTone === 'dark' ? 'dark' : 'primary'}
          />
        </SectionShell>
      );

    case 'text':
      // The old home of the benefits strip, before it became its own type.
      if (variant === 'benefits') {
        return <BenefitsBlock section={section} rhythm={rhythm} tone={preset.benefitsTone} />;
      }
      return <TextBlock section={section} rhythm={rhythm} />;

    default:
      return null;
  }
}

// ------------------------------------------------------------- sub-blocks ---

function BenefitsBlock({
  section,
  rhythm,
  tone,
}: {
  section: HomepageSection;
  rhythm: TemplatePreset['sectionRhythm'];
  tone: TemplatePreset['benefitsTone'];
}) {
  const items = readBenefits(section.config.items);
  if (items.length === 0) return null;

  return (
    <SectionShell rhythm="tight" className={rhythm === 'airy' ? 'pt-10 sm:pt-12' : undefined}>
      <BenefitsStrip items={items} tone={tone} />
    </SectionShell>
  );
}

async function CategorySection({
  section,
  context,
  style,
}: {
  section: HomepageSection;
  context: SectionContext;
  style: TemplatePreset['categoryStyle'];
}) {
  const ids = readStringArray(section.config.categoryIds);
  const all = await getCategories();

  // An explicit id list is honoured in the order it was saved; without one the
  // store's own category order is used.
  const chosen =
    ids.length > 0
      ? ids.map((id) => all.find((category) => category.id === id)).filter((c) => c !== undefined)
      : all;

  if (chosen.length === 0) return null;

  /*
   * How many tiles fit is a property of the presentation, not of the section:
   * ten circles fill a row, six photo cards do, and three editorial panels do.
   * A single configured `limit` would leave one of them with orphans on a
   * second row.
   */
  const DEFAULT_LIMIT: Record<TemplatePreset['categoryStyle'], number> = {
    circle: 10,
    card: 6,
    editorial: 3,
    // Six, not twelve: the compact grid is six wide, and eight categories left
    // two stranded on a second row.
    compact: 6,
  };
  const limit = readNumber(section.config.limit, DEFAULT_LIMIT[style]);

  return (
    <SectionShell rhythm={context.preset.sectionRhythm}>
      {/*
        The "All categories" link hangs off the heading rather than standing on
        its own. With no heading configured there is nothing for it to sit
        beside, and a lone right-aligned link above a row of tiles reads as a
        leftover — so the whole heading row disappears together.
      */}
      <SectionHeading
        title={section.title}
        subtitle={section.subtitle}
        align={style === 'editorial' ? 'center' : 'left'}
        rule={style === 'editorial'}
        action={
          section.title && style !== 'circle'
            ? { label: 'All categories', href: '/categories' }
            : null
        }
      />

      {style === 'circle' ? (
        <CategoryCircles categories={chosen} limit={limit} />
      ) : (
        <CategoryCards
          categories={chosen}
          style={style}
          limit={limit}
          showCount={style === 'compact'}
        />
      )}
    </SectionShell>
  );
}

async function ProductSection({
  section,
  context,
}: {
  section: HomepageSection;
  context: SectionContext;
}) {
  const tabs = readTabs(section);
  if (tabs.length === 0) return null;

  // Sections store ids rather than embedded copies, so a price or stock change
  // shows up here without anyone re-saving the section.
  const resolved = await Promise.all(
    tabs.map(async (tab) => ({ ...tab, products: await getProductsByIds(tab.productIds) })),
  );

  const limit = readNumber(section.config.limit, 8);
  const multiTab = resolved.filter((tab) => tab.products.length > 0).length > 1;

  return (
    <SectionShell rhythm={context.preset.sectionRhythm}>
      {/* With a tab bar, the tabs are the heading — a title above them repeats it. */}
      <SectionHeading
        title={multiTab ? null : section.title}
        subtitle={multiTab ? null : section.subtitle}
        align="center"
        rule={context.preset.categoryStyle === 'editorial'}
      />

      <ProductTabCarousel
        tabs={resolved}
        perView={context.preset.carouselPerView}
        cardVariant={context.cardVariant}
        gridClassName={context.gridClassName}
        mode={context.preset.productSectionMode}
        locale={context.config.store.language}
        limit={limit}
      />
    </SectionShell>
  );
}

async function DealSection({
  section,
  context,
}: {
  section: HomepageSection;
  context: SectionContext;
}) {
  const productId = readString(section.config.productId);
  const [product] = productId ? await getProductsByIds([productId]) : [];
  const banners = readBanners(section.config.banners);
  const deadline = readDeadline(section.config);

  if (!product && banners.length === 0) return null;

  return (
    <SectionShell rhythm={context.preset.sectionRhythm}>
      {banners.length > 0 ? (
        <PromoMosaic
          dealProduct={product ?? null}
          deadline={deadline}
          dealTitle={section.title ?? 'Deal of the Day'}
          banners={banners}
          locale={context.config.store.language}
        />
      ) : product ? (
        <DealOfTheDay
          product={product}
          deadline={deadline}
          title={section.title ?? 'Deal of the Day'}
          locale={context.config.store.language}
        />
      ) : null}
    </SectionShell>
  );
}

function TextBlock({
  section,
  rhythm,
}: {
  section: HomepageSection;
  rhythm: TemplatePreset['sectionRhythm'];
}) {
  const body = readString(section.config.body);
  if (!section.title && !body) return null;

  return (
    <SectionShell rhythm={rhythm}>
      <div className="mx-auto max-w-3xl text-center">
        {section.title ? <h2 className="text-xl font-semibold sm:text-2xl">{section.title}</h2> : null}
        {/* Plain text only — rich CMS HTML goes through the sanitised page renderer. */}
        {body ? <p className="mt-3 text-muted">{body}</p> : null}
      </div>
    </SectionShell>
  );
}

/** Renders a whole configured homepage, in the order the store chose. */
export async function HomepageSections({
  sections,
  context,
}: {
  sections: HomepageSection[];
  context: SectionContext;
}) {
  return (
    <>
      {sections.map((section, index) => (
        <SectionRenderer key={section.id} section={section} context={context} index={index} />
      ))}
    </>
  );
}
