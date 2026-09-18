import {
  SORT_OPTIONS,
  type Category,
  type HeroSlide,
  type HomepageSection,
  type PromoBanner,
  type SortValue,
  type StoreConfig,
} from '@/types';
import type { Translator } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { PAGE_SIZE } from '@/config';
import {
  getBrands,
  getCategories,
  getCategoryShowcase,
  getProductsByIds,
  primeProductSummaries,
} from '@/lib/api/catalog';
import { getProductList } from '@/lib/api/products';
import { SectionHeading, SectionShell } from '@/components/sections/section-shell';
import { HeroCarousel } from '@/components/sections/hero-carousel';
import { CategoryCircles } from '@/components/sections/category-circles';
import { CategoryCards } from '@/components/sections/category-cards';
import { CategoryDirectory } from '@/components/sections/category-directory';
import { CategoryShowcase } from '@/components/sections/category-showcase';
import { CatalogFeed } from '@/components/sections/catalog-feed';
import { BenefitsStrip } from '@/components/sections/benefits-strip';
import { PromoBannerGrid, type BannerRatio } from '@/components/sections/promo-banner-grid';
import { PromoMosaic } from '@/components/sections/promo-mosaic';
import { DealOfTheDay } from '@/components/sections/deal-of-the-day';
import { FlashSaleRail } from '@/components/sections/flash-sale-rail';
import { ProductTabCarousel } from '@/components/sections/product-tab-carousel';
import { BrandStrip } from '@/components/sections/brand-strip';
import { Lookbook } from '@/components/sections/lookbook';
import { Testimonials } from '@/components/sections/testimonials';
import { CollectionShowcase } from '@/components/sections/collection-showcase';
import { SocialGallery } from '@/components/sections/social-gallery';
import { RecentlyViewed } from '@/components/sections/recently-viewed';
import {
  readBanners,
  readBoolean,
  readBenefits,
  readCollection,
  readDeadline,
  readGalleryTiles,
  readLookbookTiles,
  readNumber,
  readString,
  readStringArray,
  readSlides,
  readTabs,
  readTestimonials,
  readVariant,
  type BenefitItem,
} from './parse';

const RATIOS = new Set<BannerRatio>(['wide', 'panel', 'tall', 'strip']);

/** A banner block's shape, when it names one. `undefined` keeps the grid's own default. */
function readRatio(value: unknown): BannerRatio | undefined {
  return typeof value === 'string' && RATIOS.has(value as BannerRatio) ? (value as BannerRatio) : undefined;
}

function readColumns(value: unknown): 1 | 2 | 3 | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

// ---------------------------------------------------------------- language ---

/*
 * Store-written copy, put into the visitor's language where it is still the copy
 * the store was seeded with.
 *
 * `t.loose` translates a string the dictionary holds and returns anything else
 * exactly as it came, so a heading that still reads "New Arrivals" is shown in
 * Bangla and one the owner retitled is left in their own words. It is applied
 * here, once, rather than inside each block, so every component below receives
 * text that is ready to draw. Product, category, brand and collection names
 * never go through it — those are the shop's data, not its furniture.
 */
const loose = (t: Translator, text: string | null): string | null => (text ? t.loose(text) : null);

function localiseSection(section: HomepageSection, t: Translator): HomepageSection {
  return { ...section, title: loose(t, section.title), subtitle: loose(t, section.subtitle) };
}

function localiseSlides(slides: HeroSlide[], t: Translator): HeroSlide[] {
  return slides.map((slide) => ({
    ...slide,
    eyebrow: loose(t, slide.eyebrow),
    heading: t.loose(slide.heading),
    // Translated alongside the heading, so the emphasised word is still found
    // inside it; a pair that no longer matches draws the heading plain.
    accentWord: loose(t, slide.accentWord),
    subheading: loose(t, slide.subheading),
    primaryCta: slide.primaryCta ? { ...slide.primaryCta, label: t.loose(slide.primaryCta.label) } : null,
    secondaryCta: slide.secondaryCta ? { ...slide.secondaryCta, label: t.loose(slide.secondaryCta.label) } : null,
    badge: slide.badge ? { ...slide.badge, text: t.loose(slide.badge.text) } : null,
    socialProof: slide.socialProof ? { ...slide.socialProof, text: t.loose(slide.socialProof.text) } : null,
  }));
}

function localiseBanners(banners: PromoBanner[], t: Translator): PromoBanner[] {
  return banners.map((banner) => ({
    ...banner,
    title: loose(t, banner.title),
    subtitle: loose(t, banner.subtitle),
    eyebrow: loose(t, banner.eyebrow),
    buttonLabel: loose(t, banner.buttonLabel),
  }));
}

function localiseBenefits(items: BenefitItem[], t: Translator): BenefitItem[] {
  return items.map((item) => ({ ...item, title: t.loose(item.title), description: loose(t, item.description) }));
}

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
  section: stored,
  context,
  index,
}: {
  section: HomepageSection;
  context: SectionContext;
  index: number;
}) {
  const t = await getT();
  const section = localiseSection(stored, t);

  // Only the first section above the fold gets image priority; everything else
  // lazy-loads, which is what keeps LCP honest.
  const isFirst = index === 0;
  const { preset, config } = context;
  const rhythm = preset.sectionRhythm;
  const variant = readVariant(section);

  switch (section.type) {
    case 'hero': {
      const slides = localiseSlides(readSlides(section), t);
      if (slides.length === 0) return null;

      return (
        <SectionShell
          rhythm="tight"
          bleed={preset.heroVariant === 'fullbleed' || preset.heroVariant === 'tech'}
          label={t('Featured')}
          className={isFirst ? 'pt-4 sm:pt-6' : undefined}
        >
          <HeroCarousel slides={slides} variant={preset.heroVariant} priority={isFirst} />
        </SectionShell>
      );
    }

    case 'category_circle':
      return <CategorySection section={section} context={context} style="circle" t={t} />;

    case 'category_grid':
      return <CategorySection section={section} context={context} style={preset.categoryStyle} t={t} />;

    case 'benefits':
      return <BenefitsBlock section={section} rhythm={rhythm} tone={preset.benefitsTone} t={t} />;

    case 'product_grid':
    case 'product_carousel':
      /*
       * A product block either asks the catalogue a question — the newest, the
       * best selling — or it *is* the catalogue. The second shape cannot be a
       * longer rail: a section's list is resolved server-side into the cached
       * homepage payload and capped at 24, so "everything" has to be paged
       * rather than named. `feed` is what picks between the two.
       */
      return readBoolean(section.config.feed) ? (
        <CatalogFeedSection section={section} context={context} t={t} />
      ) : (
        <ProductSection section={section} context={context} t={t} />
      );

    case 'promo_trio': {
      const banners = localiseBanners(readBanners(section.config.banners), t);
      if (banners.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading title={section.title} subtitle={section.subtitle} />
          <PromoBannerGrid banners={banners} columns={3} ratio="panel" />
        </SectionShell>
      );
    }

    case 'deal':
      return <DealSection section={section} context={context} t={t} />;

    case 'banner': {
      // Sections saved before `deal` and `promo_trio` were types of their own
      // still carry the discriminator in `config.variant`.
      if (variant === 'deal') return <DealSection section={section} context={context} t={t} />;

      const banners = localiseBanners(readBanners(section.config.banners), t);
      if (banners.length === 0) return null;

      /*
       * The advertising break between two rows of products is one wide strip —
       * `{ columns: 1, ratio: 'strip' }` — which is what the seed writes and
       * what `scripts/add-promo-banner-blocks.ts` gives an older store. Both
       * keys are read rather than assumed, because the same block type is also
       * how a store runs two or three campaign panels side by side, and a
       * homepage saved before either key existed must keep the shape it had.
       */
      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading title={section.title} subtitle={section.subtitle} />
          <PromoBannerGrid
            banners={banners}
            columns={readColumns(section.config.columns)}
            ratio={readRatio(section.config.ratio)}
          />
        </SectionShell>
      );
    }

    case 'flash_sale': {
      const products = await getProductsByIds(readStringArray(section.config.productIds));
      if (products.length === 0) return null;

      /*
       * No deadline, no flash sale. The block is a countdown with products
       * attached, and `home.routes.ts` only fills `endsAt` in while a campaign
       * is genuinely running — so an expired one disappears instead of becoming
       * an ordinary rail still labelled a limited offer.
       */
      const deadline = readDeadline(section.config);
      if (deadline === null) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <FlashSaleRail
            title={section.title}
            subtitle={section.subtitle}
            deadline={deadline}
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
              title={section.title}
              size="sm"
              action={{ label: t('View all'), href: '/brands' }}
            />
            <BrandStrip brands={brands} tone={preset.brandStripTone} />
          </div>
        </SectionShell>
      );
    }

    case 'lookbook': {
      const tiles = readLookbookTiles(section.config.tiles).map((tile) => ({
        ...tile,
        caption: loose(t, tile.caption),
      }));
      const ctaLabel = loose(t, readString(section.config.ctaLabel));
      const ctaHref = readString(section.config.ctaHref);
      // The copy panel is the block's left half; without a title it is a blank
      // rectangle beside four photographs.
      if (tiles.length === 0 || !section.title) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <Lookbook
            title={section.title}
            subtitle={section.subtitle}
            ctaLabel={ctaLabel}
            ctaHref={ctaHref}
            tiles={tiles}
          />
        </SectionShell>
      );
    }

    case 'testimonial': {
      // The quote and the name are the customer's own words; only the byline's
      // label ("Verified buyer") is the store's.
      const testimonials = readTestimonials(section.config.items).map((item) => ({
        ...item,
        authorTitle: loose(t, item.authorTitle),
      }));
      if (testimonials.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading title={section.title} subtitle={section.subtitle} align="center" rule />
          <Testimonials testimonials={testimonials} />
        </SectionShell>
      );
    }

    case 'collection': {
      const collection = readCollection(section.config.collection);
      const ctaLabel = loose(t, readString(section.config.ctaLabel));
      const href = readString(section.config.href);
      if (!collection || !ctaLabel || !href) return null;

      const products = await getProductsByIds(collection.productIds);
      if (products.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <CollectionShowcase
            collection={collection}
            products={products}
            href={href}
            perView={preset.carouselPerView}
            cardVariant={context.cardVariant}
            locale={config.store.language}
            ctaLabel={ctaLabel}
          />
        </SectionShell>
      );
    }

    case 'social_gallery': {
      const tiles = readGalleryTiles(section.config.tiles).map((tile) => ({
        ...tile,
        caption: loose(t, tile.caption),
      }));
      if (tiles.length === 0) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <SectionHeading title={section.title} subtitle={section.subtitle} align="center" rule />
          <SocialGallery tiles={tiles} handle={readString(section.config.handle)} />
        </SectionShell>
      );
    }

    case 'recently_viewed':
      // Rendered by the browser from the visitor's own history, so unlike every
      // other block there is nothing here for the server to check first.
      if (!section.title) return null;

      return (
        <SectionShell rhythm={rhythm}>
          <RecentlyViewed
            title={section.title}
            perView={preset.carouselPerView}
            cardVariant={context.cardVariant}
            locale={config.store.language}
          />
        </SectionShell>
      );

    case 'text':
      // The old home of the benefits strip, before it became its own type.
      if (variant === 'benefits') {
        return <BenefitsBlock section={section} rhythm={rhythm} tone={preset.benefitsTone} t={t} />;
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
  t,
}: {
  section: HomepageSection;
  rhythm: TemplatePreset['sectionRhythm'];
  tone: TemplatePreset['benefitsTone'];
  t: Translator;
}) {
  const items = localiseBenefits(readBenefits(section.config.items), t);
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
  t,
}: {
  section: HomepageSection;
  context: SectionContext;
  style: TemplatePreset['categoryStyle'];
  t: Translator;
}) {
  const ids = readStringArray(section.config.categoryIds);
  const all = await getCategories();

  /*
   * Flattened before the lookup, because `getCategories` returns a *tree* and
   * this used to search only its top level. A section pointed at subcategories —
   * "Shop Electronics", listing the aisles under Electronics — found none of
   * them and rendered nothing, with no error anywhere to say why. The block is
   * meant to work at either level; that is the whole reason it takes ids rather
   * than a depth.
   */
  const flatten = (nodes: typeof all): typeof all =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);

  const byId = new Map(flatten(all).map((category) => [category.id, category]));

  // An explicit id list is honoured in the order it was saved; without one the
  // store's own top-level order is used.
  const chosen = ids.length > 0 ? ids.map((id) => byId.get(id)).filter((c) => c !== undefined) : all;

  if (chosen.length === 0) return null;

  /*
   * `showProducts` answers the department rather than filing it.
   *
   * Both of the other arrangements list categories: the rail is a row of doors
   * and the directory is the same doors with their aisles written underneath.
   * Neither shows a single thing the shop sells, which is what a visitor came to
   * see — so this one draws each department as a panel of its aisles, every aisle
   * a rail of its own products. It is the arrangement any large shop uses, and
   * the reason is that a shopper recognises a phone on sight and has to read the
   * word Smartphones.
   *
   * It is checked before the directory because it is the richer answer to the
   * same question: a block carrying both keys — which nothing writes, but an
   * older `config` edited by hand could — shows the products.
   */
  if (readBoolean(section.config.showProducts)) {
    return <CategoryShowcaseSection section={section} context={context} categories={chosen} t={t} />;
  }

  /*
   * `showSubcategories` prints the tree instead of the top of it.
   *
   * Every other presentation here is a row of departments, and a subcategory is
   * reachable from it only by opening its parent first — so a shop with fifty
   * aisles offers twelve doors and hides the rest behind a click nobody knows to
   * make. The directory lists each department with everything inside it, which
   * is the one arrangement where "browse the shop" is answerable from the
   * homepage.
   *
   * It ignores `limit` and the per-style row widths on purpose: those exist to
   * stop a row of tiles wrapping into orphans, and this block is not a row. Its
   * whole claim is that the list is complete, and a truncated complete list is
   * just the rail again.
   */
  if (readBoolean(section.config.showSubcategories)) {
    return (
      <SectionShell rhythm={context.preset.sectionRhythm}>
        <SectionHeading
          title={section.title}
          subtitle={section.subtitle}
          action={section.title ? { label: t('All categories'), href: '/categories' } : null}
        />
        <CategoryDirectory categories={chosen} />
      </SectionShell>
    );
  }

  /*
   * How many tiles fit is a property of the presentation, not of the section:
   * six photo cards fill a row and three editorial panels do. A single
   * configured `limit` would leave one of them with orphans on a second row.
   *
   * `circle` is `null` — it is the one style that scrolls rather than fills a
   * row, so nothing about it is a row width, and a default that dropped the
   * tail would now drop it with no "More" tile left to reach it by.
   */
  const DEFAULT_LIMIT: Record<TemplatePreset['categoryStyle'], number | null> = {
    circle: null,
    card: 6,
    editorial: 3,
    // Six, not twelve: the compact grid is six wide, and eight categories left
    // two stranded on a second row.
    compact: 6,
  };
  const fallback = DEFAULT_LIMIT[style];
  const limit = section.config.limit === undefined && fallback === null
    ? undefined
    : readNumber(section.config.limit, fallback ?? chosen.length);

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
            ? { label: t('All categories'), href: '/categories' }
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

/**
 * What the showcase draws when the block says nothing.
 *
 * **One department**, because these blocks are spread between the other sections
 * of the homepage rather than stacked in one place: a shopper scrolling past a
 * promo, a rail of recommendations and a set of brand logos meets a department
 * between each of them, which is how every product on the page arrives beside
 * something unlike it. Six panels in a row is a catalogue dump wearing a
 * homepage's clothes, and it buries whatever came after it. `limit` raises it for
 * a store that wants the stacked shape back, and `offset` is what stops two
 * blocks drawing the same department.
 *
 * Three aisles of eight products, all three rendered. A tab bar would show one
 * row and hide the other two behind a click, which is the directory's problem in
 * a smaller frame — the shopper has to already know which aisle they want. Three
 * is what a panel can carry without becoming a page of its own; the aisles past
 * it are chips in the panel header. Both numbers are also bounds on the API's own
 * query, and it caps them there.
 */
const SHOWCASE_DEFAULTS = { departments: 1, rows: 3, perRow: 8 } as const;

/**
 * Each department as a panel of its aisles, every aisle a rail of its products.
 *
 * Two reads, whatever the block's size. The showcase endpoint answers which
 * products head each aisle — ids only, one query for the lot — and
 * `primeProductSummaries` resolves every one of them through the same batched
 * `?ids=` call the rest of the homepage uses, so a product this page has already
 * fetched for another rail is not fetched twice.
 *
 * The categories come from the tree this render already holds rather than from
 * the showcase response, so a department cannot be named one way in the rail at
 * the top of the page and another way here. The two are cached apart, so a
 * category added a minute ago can be in one and not the other — a row whose
 * category is not in the tree is dropped rather than drawn nameless.
 */
async function CategoryShowcaseSection({
  section,
  context,
  categories,
  t,
}: {
  section: HomepageSection;
  context: SectionContext;
  categories: Category[];
  t: Translator;
}) {
  const named = readStringArray(section.config.categoryIds);

  const groups = await getCategoryShowcase(
    // Joined rather than passed as an array: `getCategoryShowcase` is memoised
    // for the render and an array literal is a new reference every call.
    named.join(','),
    readNumber(section.config.offset, 0),
    readNumber(section.config.limit, SHOWCASE_DEFAULTS.departments),
    readNumber(section.config.rows, SHOWCASE_DEFAULTS.rows),
    readNumber(section.config.perRow, SHOWCASE_DEFAULTS.perRow),
  );

  if (groups.length === 0) return null;

  await primeProductSummaries(groups.flatMap((group) => group.rows.flatMap((row) => row.productIds)));

  // Flattened, because a row is headed by an aisle and `categories` holds
  // departments — the same reason `CategorySection` flattens before its lookup.
  const flatten = (nodes: Category[]): Category[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const byId = new Map(flatten(categories).map((category) => [category.id, category]));

  const resolved = await Promise.all(
    groups.map(async (group) => {
      const category = byId.get(group.categoryId);
      if (!category) return null;

      const rows = (
        await Promise.all(
          group.rows.map(async (row) => {
            const rowCategory = byId.get(row.categoryId);
            if (!rowCategory) return null;

            const products = await getProductsByIds(row.productIds);
            return products.length > 0 ? { category: rowCategory, products } : null;
          }),
        )
      ).filter((row) => row !== null);

      if (rows.length === 0) return null;

      return {
        category,
        // Every aisle that has something in it, previewed below or not — the chips
        // are what make the panel a complete answer about the department.
        chips: category.children.filter((child) => child.productCount > 0),
        rows,
      };
    }),
  );

  const usable = resolved.filter((group) => group !== null);
  if (usable.length === 0) return null;

  return (
    <SectionShell rhythm={context.preset.sectionRhythm}>
      <SectionHeading
        title={section.title}
        subtitle={section.subtitle}
        action={section.title ? { label: t('All categories'), href: '/categories' } : null}
      />
      <CategoryShowcase
        groups={usable}
        perView={context.preset.carouselPerView}
        cardVariant={context.cardVariant}
        locale={context.config.store.language}
      />
    </SectionShell>
  );
}

/**
 * Which order the feed reads the catalogue in.
 *
 * `newest` rather than `relevance` by default: with no search term behind it,
 * relevance is an arbitrary order that would look like a shuffle to anyone
 * scrolling a shop they have seen before.
 */
function readSort(value: unknown): SortValue {
  return SORT_OPTIONS.some((option) => option.value === value) ? (value as SortValue) : 'newest';
}

/**
 * The whole shop as a homepage block.
 *
 * The first batch is fetched here, on the server, so the block is rendered
 * markup like every other section — indexable, and costing the visitor no
 * round trip. `CatalogFeed` appends the rest through a Server Action when the
 * shopper asks for more.
 *
 * It reads the ordinary listing endpoint rather than `getProductsByIds`, which
 * is what every other product block uses: those blocks are given a list the API
 * resolved into the cached homepage payload, and this one is deliberately not
 * in that payload at all — see the note on the `feed` branch above.
 */
async function CatalogFeedSection({
  section,
  context,
  t,
}: {
  section: HomepageSection;
  context: SectionContext;
  t: Translator;
}) {
  const sort = readSort(section.config.sort);
  const result = await getProductList({ page: 1, pageSize: PAGE_SIZE.home, sort });

  if (result.items.length === 0) return null;

  return (
    <SectionShell rhythm={context.preset.sectionRhythm}>
      <SectionHeading
        title={section.title}
        subtitle={section.subtitle}
        action={section.title ? { label: t('Open the shop'), href: '/shop' } : null}
      />
      {/*
        Keyed on the batch, not on the section: when the first page a visitor
        was given is no longer the first page of the list — a product added,
        removed or re-sorted — the batches they had appended below it belong to
        a list that no longer exists. Remounting is the whole reset, and it puts
        that decision here, where the new batch is, rather than in an effect
        watching a prop.
      */}
      <CatalogFeed
        key={`${result.meta.total}:${result.items[0]?.id ?? ''}:${result.items.at(-1)?.id ?? ''}`}
        initial={result.items}
        total={result.meta.total}
        sort={sort}
        cardVariant={context.cardVariant}
        gridClassName={context.gridClassName}
        locale={context.config.store.language}
      />
    </SectionShell>
  );
}

async function ProductSection({
  section,
  context,
  t,
}: {
  section: HomepageSection;
  context: SectionContext;
  t: Translator;
}) {
  const tabs = readTabs(section).map((tab) => ({ ...tab, label: t.loose(tab.label) }));
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
  t,
}: {
  section: HomepageSection;
  context: SectionContext;
  t: Translator;
}) {
  const productId = readString(section.config.productId);
  const [product] = productId ? await getProductsByIds([productId]) : [];
  const banners = localiseBanners(readBanners(section.config.banners), t);
  const deadline = readDeadline(section.config);

  // The deal card is a titled panel; the mosaic's banners carry their own copy
  // and stand up without one, so only the standalone form insists on a title.
  if (!product && banners.length === 0) return null;
  if (banners.length === 0 && !section.title) return null;

  return (
    <SectionShell rhythm={context.preset.sectionRhythm}>
      {banners.length > 0 ? (
        <PromoMosaic
          dealProduct={product ?? null}
          deadline={deadline}
          dealTitle={section.title}
          banners={banners}
          locale={context.config.store.language}
        />
      ) : product ? (
        <DealOfTheDay
          product={product}
          deadline={deadline}
          title={section.title}
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
