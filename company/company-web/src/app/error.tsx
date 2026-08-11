'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Only the digest is safe to surface; the message may contain internals.
    console.error('Unhandled page error', error.digest);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The page failed to load. Try again — if it keeps happening, contact support
          {error.digest ? ` and quote reference ${error.digest}` : ''}.
        </p>
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
      </div>
    </main>
  );
}
