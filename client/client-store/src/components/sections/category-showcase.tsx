import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Category, ProductSummary } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { cn, pluralise } from '@/lib/utils';
import { ProductCarousel } from './product-carousel';

/**
 * One department of the shop: its aisles listed down the panel, each as a row of
 * its own products.
 *
 * The directory this replaces printed the same departments as a tree of links,
 * which answers "how is this shop filed" when the question a visitor arrives
 * with is "what do you sell" — a shopper recognises a phone on sight and has to
 * *read* the word Smartphones. So the aisles are all still here, and each one now
 * comes with the products in it.
 *
 * Five things about the shape are deliberate.
 *
 * **The aisles are stacked, not tabbed.** A tab bar shows one row and hides the
 * rest behind a click, which is the directory's problem again in a smaller frame:
 * the shopper has to already know which aisle they want. Three rows of products
 * is what makes the panel an answer rather than a menu.
 *
 * **Each row is a rail, not a grid.** An aisle here is a preview meant to be
 * scanned, and a row that scrolls sideways shows eight products in the height a
 * grid would spend on four — which matters, because the homepage carries one of
 * these panels per department spread between its other sections.
 *
 * **The chips are links, not tabs**: every aisle that has products, including the
 * ones with no row below, which is what makes the panel a complete answer about
 * the department. They need no JavaScript and stay crawlable, which a tab bar
 * hiding three panels of products is not. An aisle with nothing in it gets no
 * chip — a link to an empty listing is a dead end wearing the same clothes as a
 * live one.
 *
 * **Nothing is drawn around it.** The panel used to be a bordered card holding
 * the header and every row, which put a second frame around cards that already
 * carry one — a box of boxes, and one that pinched the rails narrower than the
 * template's own rails everywhere else on the page. The department heading, the
 * hairline under it and the space between rows carry the grouping now, so the
 * rails run the full page width at the template's own card count.
 *
 * And a **row is dropped, never emptied**: the API returns only aisles that have
 * products, so a heading here always has something under it. A department whose
 * aisles are all bare comes back as one row of its own products, drawn without a
 * heading — a row titled Electronics inside a panel titled Electronics reads as a
 * mistake.
 */
export interface ShowcaseRow {
  category: Category;
  products: ProductSummary[];
}

export interface ShowcaseGroup {
  category: Category;
  /** Every aisle worth linking to, previewed below or not. */
  chips: Category[];
  rows: ShowcaseRow[];
}

export function CategoryShowcase({
  groups,
  perView,
  cardVariant,
  locale,
  className,
}: {
  groups: ShowcaseGroup[];
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  locale: string;
  className?: string;
}) {
  if (groups.length === 0) return null;

  return (
    <div className={cn('space-y-12', className)}>
      {groups.map((group) => (
        <article key={group.category.id} className="space-y-5">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-4">
            {/* Decorative: the heading beside it links to the same place, and two
                adjacent links to one destination read as two entries to a screen
                reader. */}
            <span
              aria-hidden
              className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-alt text-base font-semibold text-subtle"
            >
              {group.category.imageUrl ? (
                <Image src={group.category.imageUrl} alt="" fill sizes="48px" className="object-cover" />
              ) : (
                group.category.name.charAt(0)
              )}
            </span>

            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-tight sm:text-xl">
                <Link href={`/category/${group.category.slug}`} className="hover:text-primary">
                  {group.category.name}
                </Link>
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted">
                {group.category.description
                  ? group.category.description
                  : `${group.category.productCount} ${pluralise(group.category.productCount, 'product')}`}
              </p>
            </div>

            <Link
              href={`/category/${group.category.slug}`}
              className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              Shop all
              <ArrowRight className="size-4" aria-hidden />
            </Link>

            {/*
              Scrolls rather than wraps, and takes the whole width under the
              heading until there is room beside it: a department with half a
              dozen aisles would otherwise push the products off the first screen
              of the panel, which is the one thing this block exists to show.
            */}
            {group.chips.length > 0 ? (
              <ul
                aria-label={`Inside ${group.category.name}`}
                className="no-scrollbar -mx-1 flex w-full min-w-0 gap-2 overflow-x-auto px-1 pb-0.5 lg:w-auto"
              >
                {group.chips.map((chip) => (
                  <li key={chip.id}>
                    <Link
                      href={`/category/${chip.slug}`}
                      className="inline-flex whitespace-nowrap rounded-(--radius-pill) border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary"
                    >
                      {chip.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </header>

          <div className="space-y-8">
            {group.rows.map((row) => (
              <section key={row.category.id}>
                {/* The one row that *is* the department needs no heading — the
                    panel above it already carries the name and the link. */}
                {row.category.id === group.category.id ? null : (
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="truncate text-sm font-semibold sm:text-base">
                      <Link href={`/category/${row.category.slug}`} className="hover:text-primary">
                        {row.category.name}
                      </Link>
                    </h4>
                    <Link
                      href={`/category/${row.category.slug}`}
                      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline sm:text-sm"
                    >
                      View all
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                )}

                <ProductCarousel
                  products={row.products}
                  perView={perView}
                  cardVariant={cardVariant}
                  locale={locale}
                  label={`${group.category.name}: ${row.category.name}`}
                />
              </section>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
