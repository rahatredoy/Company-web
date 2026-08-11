'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The route-level error boundary.
 *
 * Shows a fixed, customer-safe sentence and never the caught error. A rendering
 * failure on a storefront can carry a database column name, an internal
 * hostname or a stack trace through `error.message`, and a shopper can do
 * nothing with any of it. The digest is printed instead: it is meaningless on
 * its own and it is what lets support find the matching server log.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[storefront] render error', error);
  }, [error]);

  return (
    <div className="container-store grid min-h-[55vh] place-items-center py-16">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-6 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          <AlertTriangle className="size-6" aria-hidden />
        </span>

        <h1 className="text-3xl font-semibold">Something went wrong</h1>
        <p className="mt-3 text-muted">
          We could not load this page. Please try again — if it keeps happening, contact us and
          we will look into it.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-8 text-xs text-subtle">
            Reference <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
