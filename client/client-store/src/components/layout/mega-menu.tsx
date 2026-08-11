'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import type { CategoryMenuEntry, NavigationNode, StoreConfig } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import { cn } from '@/lib/utils';

/**
 * Desktop navigation, with dropdowns where a menu item has children.
 *
 * Opens on **click, not hover**. A hover menu is unusable on a touch screen
 * that reports itself as a pointer device, and it fires constantly for anyone
 * moving a mouse across the header on the way somewhere else. Radix then gives
 * this arrow-key navigation, focus return and outside-click dismissal for free.
 *
 * `columns-promo` adds a promotional panel beside the links, which is what the
 * denser reference designs use to put a campaign inside the navigation itself.
 */

export interface MegaMenuPromo {
  title: string;
  subtitle: string | null;
  imageUrl: string;
  href: string;
}

/**
 * "New" / "Hot" pips beside a menu label, keyed by destination.
 *
 * Keyed by `href` rather than by label so a store that renames "Sale" to
 * "Clearance" keeps its badge, and a store in another language gets one at all.
 */
export interface NavFlag {
  label: string;
  tone: 'primary' | 'sale' | 'accent';
}

const FLAG_TONES: Record<NavFlag['tone'], string> = {
  primary: 'bg-primary text-primary-foreground',
  sale: 'bg-sale text-white',
  accent: 'bg-accent text-foreground',
};

function FlagPip({ flag }: { flag: NavFlag }) {
  return (
    <span
      className={cn(
        'ml-1 rounded-(--radius-pill) px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none',
        FLAG_TONES[flag.tone],
      )}
    >
      {flag.label}
    </span>
  );
}

export function MegaMenu({
  config,
  style,
  promo,
  flags,
  className,
  linkClassName,
}: {
  config: StoreConfig;
  style: TemplatePreset['megaMenu'];
  promo?: MegaMenuPromo | null;
  flags?: Record<string, NavFlag>;
  className?: string;
  linkClassName?: string;
}) {
  const items = config.navigation.header;
  if (items.length === 0) return null;

  // The categories menu is what fills a dropdown for a nav item that points at
  // the catalogue but carries no children of its own.
  const catalogue = config.categoryMenu;

  return (
    <nav aria-label="Main" className={cn('hidden lg:block', className)}>
      <ul className="flex items-center gap-6 xl:gap-7">
        {items.map((item) => {
          const children = resolveChildren(item, catalogue);

          const flag = flags?.[item.href];

          if (style === 'none' || children.length === 0) {
            return (
              <li key={item.id}>
                <NavLink item={item} flag={flag} className={linkClassName} />
              </li>
            );
          }

          return (
            <li key={item.id}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  className={cn(
                    'inline-flex items-center gap-1 text-sm font-medium text-foreground outline-none transition-colors hover:text-primary data-[state=open]:text-primary',
                    linkClassName,
                  )}
                >
                  {item.label}
                  {flag ? <FlagPip flag={flag} /> : null}
                  <ChevronDown
                    className="size-3.5 opacity-70 transition-transform data-[state=open]:rotate-180"
                    aria-hidden
                  />
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="start"
                    sideOffset={14}
                    className={cn(
                      'z-50 rounded-(--radius-card) border border-border bg-surface p-5 shadow-[var(--shadow-raised)]',
                      'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1',
                      style === 'columns-promo' && promo ? 'w-[46rem]' : 'w-[34rem]',
                    )}
                  >
                    <div
                      className={cn(
                        'grid gap-6',
                        style === 'columns-promo' && promo
                          ? 'grid-cols-[1fr_15rem]'
                          : 'grid-cols-1',
                      )}
                    >
                      <div className="grid grid-cols-3 gap-x-5 gap-y-4">
                        {children.map((group) => (
                          <div key={group.id}>
                            <DropdownMenu.Item asChild>
                              <Link
                                href={group.href}
                                className="block cursor-pointer text-[13px] font-semibold outline-none hover:text-primary data-[highlighted]:text-primary"
                              >
                                {group.label}
                              </Link>
                            </DropdownMenu.Item>

                            {group.children.length > 0 ? (
                              <ul className="mt-2 space-y-1.5">
                                {group.children.map((child) => (
                                  <li key={child.id}>
                                    <DropdownMenu.Item asChild>
                                      <Link
                                        href={child.href}
                                        className="block cursor-pointer text-[13px] text-muted outline-none hover:text-primary data-[highlighted]:text-primary"
                                      >
                                        {child.label}
                                      </Link>
                                    </DropdownMenu.Item>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      {style === 'columns-promo' && promo ? (
                        <DropdownMenu.Item asChild>
                          <Link
                            href={promo.href}
                            className="group relative flex aspect-3/4 cursor-pointer items-end overflow-hidden rounded-(--radius-card) outline-none"
                          >
                            <Image
                              src={promo.imageUrl}
                              alt=""
                              aria-hidden
                              fill
                              sizes="240px"
                              className="object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <span
                              aria-hidden
                              className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent"
                            />
                            <span className="relative p-4 text-white">
                              <span className="block text-sm font-semibold">{promo.title}</span>
                              {promo.subtitle ? (
                                <span className="mt-0.5 block text-xs opacity-85">{promo.subtitle}</span>
                              ) : null}
                            </span>
                          </Link>
                        </DropdownMenu.Item>
                      ) : null}
                    </div>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavLink({
  item,
  flag,
  className,
}: {
  item: NavigationNode;
  flag?: NavFlag;
  className?: string;
}) {
  return (
    <Link
      href={item.href}
      target={item.opensInNewTab ? '_blank' : undefined}
      rel={item.opensInNewTab ? 'noreferrer noopener' : undefined}
      className={cn(
        'inline-flex items-center text-sm font-medium text-foreground transition-colors hover:text-primary',
        className,
      )}
    >
      {item.label}
      {flag ? <FlagPip flag={flag} /> : null}
    </Link>
  );
}

/**
 * What goes inside a nav item's dropdown.
 *
 * Explicit children win. A nav item that points at the catalogue but has none
 * borrows the store's category tree, so "Categories" opens onto something
 * useful without the owner having to rebuild the tree by hand in the menu
 * editor.
 */
function resolveChildren(item: NavigationNode, catalogue: CategoryMenuEntry[]): NavigationNode[] {
  if (item.children.length > 0) return item.children;

  const looksLikeCatalogue = /^\/(categories|shop)\/?$/.test(item.href);
  if (!looksLikeCatalogue || catalogue.length === 0) return [];

  return catalogue.slice(0, 6).map((entry) => ({
    id: entry.id,
    label: entry.name,
    href: `/category/${entry.slug}`,
    opensInNewTab: false,
    children: entry.children.map((child) => ({
      id: child.id,
      label: child.name,
      href: `/category/${child.slug}`,
      opensInNewTab: false,
      children: [],
    })),
  }));
}
