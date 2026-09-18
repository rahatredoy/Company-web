'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';

/**
 * Password reset, both halves.
 *
 * Requesting a link **always** reports success, whether or not the address has
 * an account. Saying "no account found" turns this form into a free membership
 * check for any address someone cares to try, and the message it would save is
 * worth far less than that.
 */
export function ForgotPasswordForm() {
  const t = useT();
  const [state, setState] = React.useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === 'sending') return;

    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setState('sending');
    setError(null);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      // 400 means the address was not a valid email, which is worth saying.
      // Anything else resolves to the same neutral confirmation.
      if (response.status === 400) {
        setError(t('Please enter a valid email address.'));
        setState('idle');
        return;
      }

      setState('sent');
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <Alert tone="success" title={t('Check your inbox')}>
        {t('If that address has an account, a reset link is on its way. The link is valid for one hour.')}
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field name="email" label={t('Email address')} required>
        {(props) => <Input {...props} type="email" autoComplete="email" autoFocus />}
      </Field>

      {error ? (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={state === 'sending'}>
        {state === 'sending' ? <Spinner /> : null}
        {t('Send reset link')}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const t = useT();
  const [state, setState] = React.useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  if (!token) {
    return (
      <Alert tone="warning" title={t('This link is not valid')}>
        {t(
          'Reset links expire after an hour and can only be used once. Request a new one from the forgot-password page.',
        )}
      </Alert>
    );
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === 'saving') return;

    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');

    if (password.length < 8) {
      setError(t('Use at least 8 characters.'));
      return;
    }
    if (password !== confirm) {
      setError(t('These passwords do not match.'));
      return;
    }

    setState('saving');
    setError(null);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The token identifies the account. No email is sent — the reset link is
        // the proof, and an address alongside it would only be something for the
        // server to disagree with.
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        setError(t('This link has expired. Please request a new one.'));
        setState('idle');
        return;
      }

      setState('done');
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <Alert tone="success" title={t('Password updated')}>
        {t(
          'You can now sign in with your new password. Any other devices you were signed in on have been signed out.',
        )}
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field name="password" label={t('New password')} required hint={t('At least 8 characters')}>
        {(props) => <Input {...props} type="password" autoComplete="new-password" autoFocus />}
      </Field>

      <Field name="confirmPassword" label={t('Confirm new password')} required>
        {(props) => <Input {...props} type="password" autoComplete="new-password" />}
      </Field>

      {error ? (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={state === 'saving'}>
        {state === 'saving' ? <Spinner /> : null}
        {t('Set new password')}
      </Button>
    </form>
  );
}
