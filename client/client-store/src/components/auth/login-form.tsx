'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { safeRedirectPath } from '@/lib/utils';

/**
 * Sign in.
 *
 * The `?next=` destination goes through `safeRedirectPath` before it is used.
 * A login page that redirects to whatever a query parameter says is an open
 * redirect, and an open redirect on a *login* page is a ready-made phishing
 * flow: the link looks like the real shop, the sign-in is real, and the landing
 * afterwards is not.
 */
export function LoginForm({ next }: { next?: string }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const destination = safeRedirectPath(next, '/account');

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: String(data.get('email') ?? '').trim(),
          password: String(data.get('password') ?? ''),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Those details do not match an account.');
        setSubmitting(false);
        return;
      }

      // A full navigation, not `router.push` — the session cookie was just set
      // and every server component needs to re-render knowing about it.
      window.location.assign(destination);
    } catch {
      setError('We could not reach the store. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field name="email" label="Email address" required>
        {(props) => <Input {...props} type="email" autoComplete="email" autoFocus />}
      </Field>

      <div>
        <Field name="password" label="Password" required>
          {(props) => <Input {...props} type="password" autoComplete="current-password" />}
        </Field>
        <div className="mt-1.5 text-right">
          <Link
            href="/forgot-password"
            className="text-xs text-muted underline-offset-2 hover:text-primary hover:underline"
          >
            Forgot your password?
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        Sign in
      </Button>
    </form>
  );
}
