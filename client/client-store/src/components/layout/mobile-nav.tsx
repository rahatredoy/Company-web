'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Menu, X } from 'lucide-react';
import type { StoreConfig } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Mobile navigation drawer.
 *
 * Built on a real dialog primitive rather than a styled `div`, so focus is
 * trapped while it is open, Escape closes it, and the page behind is hidden
 * from screen readers — none of which comes for free with a hand-rolled
 * off-canvas panel.
 *
 * Categories are read from store configuration; nothing here is hard-coded.
 */
export function MobileNav({ config }: { config: StoreConfig }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // Navigating must close the drawer, or the visitor lands on a page they
  // cannot see.
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="grid size-11 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt lg:hidden"
        >
          <Menu className="size-5" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-sm flex-col bg-surface shadow-[var(--shadow-raised)] data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-base font-semibold">{config.store.name}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="grid size-10 place-items-center rounded-(--radius-button) text-foreground hover:bg-surface-alt"
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Browse categories and shop links for {config.store.name}.
          </Dialog.Description>

          <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-2 py-3">
            <ul className="space-y-0.5">
              {config.navigation.header.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="block rounded-(--radius-button) px-3 py-2.5 text-sm font-medium hover:bg-surface-alt"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>

            {config.categoryMenu.length > 0 ? (
              <>
                <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  Categories
                </p>
                <ul className="space-y-0.5">
                  {config.categoryMenu.map((category) => {
                    const isOpen = expanded === category.id;
                    const hasChildren = category.children.length > 0;

                    return (
                      <li key={category.id}>
                        <div className="flex items-center">
                          <Link
                            href={`/category/${category.slug}`}
                            className="flex-1 rounded-(--radius-button) px-3 py-2.5 text-sm hover:bg-surface-alt"
                          >
                            {category.name}
                          </Link>
                          {hasChildren ? (
                            <button
                              type="button"
                              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${category.name}`}
                              aria-expanded={isOpen}
                              onClick={() => setExpanded(isOpen ? null : category.id)}
                              className="grid size-10 place-items-center rounded-(--radius-button) text-subtle hover:bg-surface-alt"
                            >
                              <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
                            </button>
                          ) : null}
                        </div>

                        {hasChildren && isOpen ? (
                          <ul className="ml-3 border-l border-border pl-2">
                            {category.children.map((child) => (
                              <li key={child.id}>
                                <Link
                                  href={`/category/${child.slug}`}
                                  className="block rounded-(--radius-button) px-3 py-2 text-sm text-muted hover:bg-surface-alt hover:text-foreground"
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
              </>
            ) : null}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
