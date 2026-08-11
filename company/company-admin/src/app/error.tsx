'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Admin error', error.digest);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The panel failed to load
          {error.digest ? `. Reference ${error.digest}` : ''}.
        </p>
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
      </div>
    </main>
  );
}
