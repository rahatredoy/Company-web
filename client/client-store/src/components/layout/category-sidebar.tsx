import Image from 'next/image';
import Link from 'next/link';
import {
  ChevronRight,
  Grid2x2,
  Menu,
  Shirt,
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
 * Icons are chosen from a closed set by the slug, not loaded from a URL in the
 * data. A category icon field that accepted arbitrary URLs would let admin
 * content pull remote images into the header of every page.
 */
const SLUG_ICONS: Record<string, LucideIcon> = {};

function iconFor(entry: CategoryMenuEntry): LucideIcon {
  return SLUG_ICONS[entry.slug] ?? Shirt;
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
                ) : (
                  <Icon className="size-4 shrink-0 text-subtle group-hover:text-primary" aria-hidden />
                )}

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
