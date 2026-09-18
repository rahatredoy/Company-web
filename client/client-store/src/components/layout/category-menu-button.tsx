'use client';

import * as React from 'react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Menu } from 'lucide-react';
import type { StoreConfig } from '@/types';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * The solid "All Categories" button that opens a department list.
 *
 * The compact alternative to the always-visible sidebar, for templates whose
 * hero runs the full width. Radix supplies the keyboard handling, focus
 * management and outside-click dismissal — the parts of a bespoke dropdown that
 * are usually missing.
 *
 * A category with children gets a submenu; one without is a plain link, so the
 * menu never opens onto an empty panel.
 */
export function CategoryMenuButton({
  config,
  tone = 'primary',
  label,
  className,
}: {
  config: StoreConfig;
  tone?: 'primary' | 'dark' | 'outline';
  label?: string;
  className?: string;
}) {
  const t = useT();
  if (config.categoryMenu.length === 0) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          'inline-flex h-11 items-center gap-2 rounded-(--radius-button) px-4 text-sm font-semibold transition-colors',
          tone === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary-hover',
          tone === 'dark' && 'bg-secondary text-secondary-foreground hover:opacity-90',
          tone === 'outline' && 'border border-border-strong bg-surface text-foreground hover:bg-surface-alt',
          className,
        )}
      >
        <Menu className="size-4" aria-hidden />
        <span>{label ?? t('All Categories')}</span>
        <ChevronDown className="size-4 opacity-80" aria-hidden />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className={cn(
            'z-50 max-h-[70vh] w-64 overflow-y-auto rounded-(--radius-card) border border-border bg-surface p-1.5 shadow-[var(--shadow-raised)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          {config.categoryMenu.map((entry) =>
            entry.children.length > 0 ? (
              <DropdownMenu.Sub key={entry.id}>
                <DropdownMenu.SubTrigger className="flex cursor-pointer items-center justify-between gap-2 rounded-(--radius-button) px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-alt data-[state=open]:bg-surface-alt">
                  {entry.name}
                  <ChevronDown className="size-3.5 -rotate-90 text-subtle" aria-hidden />
                </DropdownMenu.SubTrigger>

                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={4}
                    className="z-50 w-56 rounded-(--radius-card) border border-border bg-surface p-1.5 shadow-[var(--shadow-raised)]"
                  >
                    <MenuLink href={`/category/${entry.slug}`} label={t('All {name}', { name: entry.name })} emphasis />
                    {entry.children.map((child) => (
                      <MenuLink key={child.id} href={`/category/${child.slug}`} label={child.name} />
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            ) : (
              <MenuLink key={entry.id} href={`/category/${entry.slug}`} label={entry.name} />
            ),
          )}

          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <MenuLink href="/categories" label={t('View all categories')} emphasis />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuLink({ href, label, emphasis = false }: { href: string; label: string; emphasis?: boolean }) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className={cn(
          'block cursor-pointer rounded-(--radius-button) px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-alt',
          emphasis && 'font-medium text-primary',
        )}
      >
        {label}
      </Link>
    </DropdownMenu.Item>
  );
}
