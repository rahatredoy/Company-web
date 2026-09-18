import Link from 'next/link';
import { Store } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { getT } from '@/lib/i18n/server';
import { serverGetOptional } from '@/lib/server-api';
import type { SessionResponse } from '@/lib/types';

/**
 * Shell for every signed-out screen. The store name is read on the server so a
 * visitor sees whose store they are signing in to before the form appears.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [session, t] = await Promise.all([
    serverGetOptional<SessionResponse>('/api/v1/admin/auth/session'),
    getT(),
  ]);
  const storeName = session && !session.authenticated ? session.store?.name : undefined;

  return (
    <div className="relative flex min-h-svh flex-col bg-surface">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--primary-soft),transparent)]"
      />

      <header className="relative flex items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Store className="size-4.5" />
          </span>
          <span className="text-sm leading-tight">
            {storeName ?? t('Store Admin')}
            <span className="block text-xs font-normal text-muted-foreground">{t('Admin panel')}</span>
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 items-start justify-center px-6 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
