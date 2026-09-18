'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Baby,
  Book,
  Car,
  ChevronRight,
  Dumbbell,
  Flower2,
  Gamepad2,
  HeartPulse,
  Laptop,
  Music,
  PawPrint,
  Printer,
  Shirt,
  ShoppingBasket,
  Sofa,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryMenuEntry, StoreConfig } from '@/types';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * The vertical category rail beside the hero.
 *
 * Two of the reference designs put this at the top-left of the homepage, which
 * is a very old and very effective pattern for a catalogue too broad to fit in
 * a horizontal nav — it puts every department one click away without a hover
 * menu that a touch device cannot open.
 *
 * Entries come from store configuration and are never hard-coded. A store with
 * no category menu renders nothing rather than an empty panel.
 *
 * A department with aisles beneath it **opens** rather than navigates: the row
 * is a disclosure button, and the aisles unfold under it. One at a time —
 * opening a second closes the first, which is why this is a single `expanded`
 * id rather than a set. A rail tall enough to hold every department's children
 * at once is a rail nobody can see the bottom of, so it stops at the height of
 * the hero and scrolls.
 *
 * **Every department is listed, and the rail scrolls to the rest.** It used to
 * stop at ten and end on a `More Categories` link to `/categories`, which asked
 * the reader to leave the page to answer "is what I want in here?" — something
 * a scroll answers where they are standing. The height cap is what makes that
 * safe, and the cap is **the hero beside it** rather than a figure: it was a
 * flat `26rem`, which is taller than the hero at some widths and shorter at
 * others, so the rail overhung the campaign it sits next to. The panel is
 * absolutely positioned inside a stretched grid cell instead — the cell takes
 * its height from the hero (the rail contributes nothing to sizing the row),
 * and `max-h-full` is what stops the list at exactly that line. It is a
 * `max-height`, not a height, so a shop with four departments still gets a
 * short panel rather than a tall box mostly full of nothing.
 *
 * That makes the two bottom edges line up at every width and for any hero
 * artwork, which a fixed cap could only manage by coincidence.
 *
 * **The scrollbar is hidden and the panel has no header.** A track running down
 * the right of a list this narrow eats a column of the names beside it and
 * announces the cap rather than the categories; the list still scrolls, by wheel,
 * touch and keyboard. The `All Categories` bar above it named what the reader
 * could already see — a list of categories — and cost the panel a row.
 *
 * The department's own page is still one click away, as `All <name>` at the top
 * of what it opens — the same wording `category-menu-button.tsx` uses for the
 * same reason. Without it the click that used to reach the category page would
 * have nowhere left to go.
 */

/**
 * Icons are chosen from a closed set by key, not loaded from a URL in the data.
 * A category icon field that accepted arbitrary URLs would let admin content
 * pull remote images into the header of every page.
 *
 * The store picks the key per category (`categoryIcons` in the header config).
 * This map was empty for a while and `iconFor` fell through to `Shirt`, so a
 * store selling car parts had a t-shirt beside Automotive — the icon was worse
 * than no icon, because it asserted something false about the category.
 * Unmapped now means no glyph at all.
 */
const ICONS: Record<string, LucideIcon> = {
  electronics: Laptop,
  fashion: Shirt,
  home: Sofa,
  beauty: Sparkles,
  sports: Dumbbell,
  toys: Gamepad2,
  tools: Wrench,
  automotive: Car,
  books: Book,
  health: HeartPulse,
  pets: PawPrint,
  garden: Flower2,
  grocery: ShoppingBasket,
  music: Music,
  baby: Baby,
  office: Printer,
};

function iconFor(entry: CategoryMenuEntry): LucideIcon | null {
  return entry.iconKey ? (ICONS[entry.iconKey] ?? null) : null;
}

export function CategorySidebar({
  config,
  className,
}: {
  config: StoreConfig;
  className?: string;
}) {
  const t = useT();
  /** The one open department, or none. A second open closes the first. */
  const [expanded, setExpanded] = React.useState<string | null>(null);

  /*
   * Fired by React when the panel mounts — which is exactly when a department
   * opens. The rail is height-capped and scrolls, so opening the last one would
   * otherwise unfold its aisles below the fold and read as nothing happening.
   * `nearest` scrolls the rail by the least it can, and leaves the page alone.
   */
  const revealOnOpen = React.useCallback((node: HTMLUListElement | null) => {
    node?.scrollIntoView({ block: 'nearest' });
  }, []);

  if (config.categoryMenu.length === 0) return null;

  const entries = config.categoryMenu;

  return (
    /*
     * The positioned cell, not the panel. It is stretched by the grid to the
     * height of the hero and holds nothing that sizes it, which is what makes
     * `max-h-full` on the panel resolve against the hero's height.
     */
    <div className={cn('relative hidden lg:block', className)}>
      <nav
        aria-label={t('Categories')}
        className="absolute inset-x-0 top-0 flex max-h-full flex-col overflow-hidden rounded-[5px] border-[0.5px] border-border/70 bg-surface"
      >
        <ul className="no-scrollbar min-h-0 flex-auto overflow-y-auto py-1.5">
          {entries.map((entry) => {
            const Icon = iconFor(entry);
            const hasChildren = entry.children.length > 0;
            const isOpen = expanded === entry.id;
            const panelId = `category-rail-${entry.id}`;

            /*
             * Identical inside a button and inside a link, so it is built once.
             * The two differ in what a click does, not in what a reader sees.
             */
            const face = (
              <>
                {Icon ? (
                  <Icon
                    className={cn(
                      'size-4 shrink-0 transition-colors group-hover:text-primary',
                      isOpen ? 'text-primary' : 'text-subtle',
                    )}
                    aria-hidden
                  />
                ) : null}

                <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>

                {hasChildren ? (
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-subtle transition-transform duration-200',
                      isOpen && 'rotate-90',
                    )}
                    aria-hidden
                  />
                ) : null}
              </>
            );

            const rowClass = cn(
              'group flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-foreground',
              'transition-colors hover:bg-surface-alt hover:text-primary',
              isOpen && 'bg-surface-alt font-medium text-primary',
            );

            return (
              <li key={entry.id}>
                {hasChildren ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setExpanded(isOpen ? null : entry.id)}
                    className={rowClass}
                  >
                    {face}
                  </button>
                ) : (
                  <Link href={`/category/${entry.slug}`} className={rowClass}>
                    {face}
                  </Link>
                )}

                {hasChildren && isOpen ? (
                  <ul id={panelId} ref={revealOnOpen} className="ml-[1.85rem] border-l border-border pb-1 pl-2">
                    <li>
                      <Link
                        href={`/category/${entry.slug}`}
                        className="block truncate rounded-(--radius-button) px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface-alt"
                      >
                        {t('All {name}', { name: entry.name })}
                      </Link>
                    </li>

                    {entry.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={`/category/${child.slug}`}
                          className="block truncate rounded-(--radius-button) px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
                        >
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
