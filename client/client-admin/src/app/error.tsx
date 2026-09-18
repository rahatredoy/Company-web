'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

/**
 * Last line of defence for a failed server render — most often the platform
 * being unreachable, which the dashboard layout cannot recover from on its own.
 * Without this, such a failure surfaces as a raw uncaught error.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  React.useEffect(() => {
    // Only the digest is safe to surface; the message may carry internals.
    console.error('Store admin error', error.digest);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Something went wrong')}</h1>
        <p className="text-sm text-muted-foreground">
          {error.digest
            ? t('The panel could not be loaded. This is usually temporary — try again in a moment, quoting reference {reference}.', {
                reference: error.digest,
              })
            : t('The panel could not be loaded. This is usually temporary — try again in a moment.')}
        </p>
        <Button onClick={reset}>
          <RefreshCw /> {t('Try again')}
        </Button>
      </div>
    </main>
  );
}
