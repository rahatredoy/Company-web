'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Account page error', error.digest);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-destructive-soft text-destructive">
          <AlertTriangle className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">This page could not be loaded</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Something went wrong while fetching your account data. Try again — if it keeps happening,
            contact support
            {error.digest ? ` and quote reference ${error.digest}` : ''}.
          </p>
        </div>
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
      </CardContent>
    </Card>
  );
}
