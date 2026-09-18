'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Menu, Search, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { NotificationsMenu } from './notifications-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { publicEnv } from '@/lib/env';
import type { AdminMe } from '@/lib/types';

export function AdminTopbar({
  admin,
  title,
  unreadCount = 0,
  onOpenMobileNav,
}: {
  admin: AdminMe;
  title: string;
  unreadCount?: number;
  onOpenMobileNav: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K focuses global search, matching the rest of the product.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (term) router.push(`/clients?search=${encodeURIComponent(term)}`);
  };

  const signOut = async () => {
    try {
      await api.post('/api/v1/admin/logout');
    } catch {
      // Local sign-out proceeds regardless.
    } finally {
      router.push('/sign-in');
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label="Open menu"
          onClick={onOpenMobileNav}
        >
          <Menu />
        </Button>

        <h1 className="text-lg font-semibold tracking-tight whitespace-nowrap">{title}</h1>

        <form onSubmit={submitSearch} className="mx-auto hidden w-full max-w-lg md:block" role="search">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients, domains, invoices…"
              aria-label="Search"
              className="pr-16 pl-9"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />

          <NotificationsMenu initialUnread={unreadCount} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2.5 rounded-lg p-1 pr-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                aria-label="Admin menu"
              >
                <Avatar className="size-8">
                  <AvatarFallback>CA</AvatarFallback>
                </Avatar>
                <span className="hidden flex-col items-start leading-tight sm:flex">
                  <span className="text-sm font-medium">Company Admin</span>
                  <span className="text-[10.5px] text-muted-foreground">Super Admin</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Signed in</DropdownMenuLabel>
              <div className="px-2.5 pb-2">
                <p className="truncate text-sm font-medium">{admin.email}</p>
                <p className="text-xs text-muted-foreground">Platform administrator</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <User /> Account settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings?tab=security">
                  <ShieldCheck /> Security
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={publicEnv.websiteUrl} target="_blank" rel="noreferrer noopener">
                  Open public website
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={signOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
