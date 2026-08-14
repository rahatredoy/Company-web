import Image from 'next/image';
import Link from 'next/link';
import {
  Baby,
  Book,
  Car,
  ChevronRight,
  Dumbbell,
  Flower2,
  Gamepad2,
  Grid2x2,
  HeartPulse,
  Laptop,
  Menu,
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
  title = 'All Categories',
  headerTone = 'primary',
  maxItems = 10,
  className,
}: {
  config: StoreConfig;
  title?: string;
  headerTone?: 'primary' | 'dark' | 'plain';
  maxItems?: number;
  className?: string;
}) {
  if (config.categoryMenu.length === 0) return null;

  const entries = config.categoryMenu.slice(0, maxItems);
  const hasMore = config.categoryMenu.length > entries.length;

  return (
    <nav
      aria-label="Categories"
      className={cn(
        'hidden overflow-hidden rounded-(--radius-card) border border-border bg-surface lg:block',
        className,
      )}
    >
      <p
        className={cn(
          'flex items-center gap-2 px-4 py-3 text-sm font-semibold',
          headerTone === 'primary' && 'bg-primary text-primary-foreground',
          headerTone === 'dark' && 'bg-secondary text-secondary-foreground',
          headerTone === 'plain' && 'border-b border-border text-foreground',
        )}
      >
        <Menu className="size-4" aria-hidden />
        {title}
      </p>

      <ul className="max-h-[26rem] overflow-y-auto py-1">
        {entries.map((entry) => {
          const Icon = iconFor(entry);

          return (
            <li key={entry.id}>
              <Link
                href={`/category/${entry.slug}`}
                className="group flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-alt hover:text-primary"
              >
                {entry.iconUrl ? (
                  <span className="relative size-4 shrink-0">
                    <Image src={entry.iconUrl} alt="" aria-hidden fill sizes="16px" className="object-contain" />
                  </span>
                ) : Icon ? (
                  <Icon className="size-4 shrink-0 text-subtle group-hover:text-primary" aria-hidden />
                ) : null}

                <span className="min-w-0 flex-1 truncate">{entry.name}</span>

                {entry.children.length > 0 ? (
                  <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
                ) : null}
              </Link>
            </li>
          );
        })}

        {hasMore ? (
          <li>
            <Link
              href="/categories"
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-surface-alt"
            >
              <Grid2x2 className="size-4 shrink-0" aria-hidden />
              More Categories
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
