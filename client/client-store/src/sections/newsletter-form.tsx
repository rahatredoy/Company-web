'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type State = 'idle' | 'loading' | 'success' | 'error';

/**
 * Newsletter sign-up.
 *
 * Never echoes a backend outcome beyond "it worked" or "it didn't". A subscribe
 * box that reports "this email is already registered" is an account-enumeration
 * oracle, so a new subscriber and an existing one both end here on the same
 * confirmation — which is also why the route handler returns 204 either way.
 */
export function NewsletterForm({
  tone = 'onBrand',
  className,
}: {
  /** `onBrand` sits on a coloured band; `plain` on a neutral surface. */
  tone?: 'onBrand' | 'plain';
  className?: string;
}) {
  const [state, setState] = React.useState<State>('idle');
  const [email, setEmail] = React.useState('');

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (state === 'loading') return;

    setState('loading');
    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setState(response.ok ? 'success' : 'error');
      if (response.ok) setEmail('');
    } catch {
      setState('error');
    }
  }

  if (state === 'success') {
    return (
      <p role="status" className={cn('text-sm font-medium', className)}>
        Thanks — you are on the list. Look out for our next update.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className={cn('w-full', className)} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <Input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email address"
          aria-describedby={state === 'error' ? 'newsletter-error' : undefined}
          aria-invalid={state === 'error' || undefined}
          className={cn(
            'flex-1',
            tone === 'onBrand' && 'border-transparent focus-visible:ring-white/40',
          )}
        />

        <Button
          type="submit"
          variant={tone === 'onBrand' ? 'secondary' : 'primary'}
          disabled={state === 'loading'}
        >
          {state === 'loading' ? <Spinner /> : null}
          Subscribe
        </Button>
      </div>

      {state === 'error' ? (
        <p id="newsletter-error" role="alert" className="mt-2 text-sm">
          That did not work. Please check the address and try again.
        </p>
      ) : null}
    </form>
  );
}
