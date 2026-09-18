'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * `useSyncExternalStore` answers false while the server renders and true once
 * the client has hydrated, which is the whole of what a mount flag was for. The
 * store never changes, so `subscribe` has nothing to do — the two snapshot
 * functions carry the difference.
 */
const subscribeToNothing = () => () => {};
const useHydrated = () => React.useSyncExternalStore(subscribeToNothing, () => true, () => false);

/**
 * Two-state theme control (light / dark). Renders a stable placeholder until
 * hydrated so the server and client markup match.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const t = useT();

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn('relative', className)}
        aria-label={t('Toggle theme')}
        disabled
      >
        <Sun />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('relative', className)}
      aria-label={isDark ? t('Switch to light theme') : t('Switch to dark theme')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <Sun className="scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
    </Button>
  );
}
