'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';
import { useT } from '@/lib/i18n';

export function Toaster() {
  const { resolvedTheme } = useTheme();
  const t = useT();

  return (
    <Sonner
      theme={(resolvedTheme as 'light' | 'dark') ?? 'dark'}
      position="top-right"
      richColors
      closeButton
      // Sonner's own screen-reader words, which would otherwise stay English.
      containerAriaLabel={t('Notifications')}
      toastOptions={{
        closeButtonAriaLabel: t('Close toast'),
        classNames: {
          toast: 'rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-raised)]',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
