'use client';

import Link from 'next/link';
import { LogOut, Menu, Settings, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useT } from '@/lib/i18n';
import { useSession } from './session-provider';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function AdminTopbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { admin, store, signOut } = useSession();
  const t = useT();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMenu} aria-label={t('Open menu')}>
        <Menu />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* The trial banner is the one thing an owner must never miss. */}
        {store.trial && store.trial.status === 'active' ? (
          <Badge variant="warning">
            {t.plural(store.trial.daysRemaining, 'Trial · {count} day left', 'Trial · {count} days left')}
          </Badge>
        ) : null}
        {store.planName ? <Badge variant="neutral">{store.planName}</Badge> : null}
      </div>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-secondary"
            aria-label={t('Account menu')}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {initials(admin.fullName)}
            </span>
            <span className="hidden text-sm font-medium sm:block">{admin.fullName.split(' ')[0]}</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <span className="block truncate font-medium">{admin.fullName}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{admin.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link href="/account">
              <User /> {t('My profile')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/account/security">
              <ShieldCheck /> {t('Security')}
              {!admin.mfaEnabled ? (
                <Badge variant="warning" className="ml-auto">
                  {t('2FA off')}
                </Badge>
              ) : null}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> {t('Store settings')}
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => void signOut()}>
            <LogOut /> {t('Sign out')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
