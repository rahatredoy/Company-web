'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={(resolvedTheme as 'light' | 'dark') ?? 'dark'}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-raised)]',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
