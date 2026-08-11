'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CheckboxField } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { safeRedirectPath } from '@/lib/utils';

/**
 * Create an account.
 *
 * Asks for four things. Every extra required field on a registration form is a
 * reason not to finish it, and none of birthday, gender or company are needed
 * to sell somebody a shirt — the checkout collects the address when it is
 * actually required.
 *
 * Password confirmation is checked here rather than server-side because it is
 * purely a typing check; the server has no second field to compare against.
 */
export function RegisterForm({ next }: { next?: string }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [accepted, setAccepted] = React.useState(false);

  const destination = safeRedirectPath(next, '/account');

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');

    if (password !== confirm) {
      setFieldErrors({ confirmPassword: 'These passwords do not match.' });
      return;
    }
    if (!accepted) {
      setFieldErrors({ acceptsTerms: 'Please accept the terms to continue.' });
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: String(data.get('fullName') ?? '').trim(),
          email: String(data.get('email') ?? '').trim(),
          phone: String(data.get('phone') ?? '').trim() || undefined,
          password,
          acceptsTerms: true,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; details?: Record<string, string> }
          | null;
        setError(body?.error ?? 'We could not create your account.');
        if (body?.details) setFieldErrors(body.details);
        setSubmitting(false);
        return;
      }

      window.location.assign(destination);
    } catch {
      setError('We could not reach the store. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field name="fullName" label="Full name" required error={fieldErrors.fullName}>
        {(props) => <Input {...props} autoComplete="name" autoFocus />}
      </Field>

      <Field name="email" label="Email address" required error={fieldErrors.email}>
        {(props) => <Input {...props} type="email" autoComplete="email" />}
      </Field>

      <Field name="phone" label="Phone" hint="Optional — used only for delivery updates">
        {(props) => <Input {...props} type="tel" autoComplete="tel" />}
      </Field>

      <Field
        name="password"
        label="Password"
        required
        hint="At least 8 characters"
        error={fieldErrors.password}
      >
        {(props) => <Input {...props} type="password" autoComplete="new-password" minLength={8} />}
      </Field>

      <Field
        name="confirmPassword"
        label="Confirm password"
        required
        error={fieldErrors.confirmPassword}
      >
        {(props) => <Input {...props} type="password" autoComplete="new-password" />}
      </Field>

      <div>
        <CheckboxField
          id="acceptsTerms"
          checked={accepted}
          onCheckedChange={(value) => setAccepted(value === true)}
          label={
            <>
              I accept the{' '}
              <Link href="/page/terms" className="text-primary underline underline-offset-2">
                terms
              </Link>{' '}
              and{' '}
              <Link href="/page/privacy" className="text-primary underline underline-offset-2">
                privacy policy
              </Link>
            </>
          }
        />
        {fieldErrors.acceptsTerms ? (
          <p className="mt-1 text-xs font-medium text-error">{fieldErrors.acceptsTerms}</p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        Create account
      </Button>
    </form>
  );
}
