'use client';

import * as React from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Marketing page error', error.digest);
  }, [error]);

  return (
    <div className="container-page grid place-items-center py-28 text-center">
      <div className="max-w-md space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">This page could not be loaded</h1>
        <p className="text-sm text-muted-foreground">
          Try again in a moment. If it keeps happening, let us know.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button onClick={reset}>
            <RefreshCw /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Contact support</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
