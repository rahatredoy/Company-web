'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { safeRedirectPath } from '@/lib/utils';

/**
 * Sign in with a phone number — which is also how an account is created with
 * one, because to somebody holding a handset those are the same act. There is no
 * separate "register with phone" form anywhere, and there should not be: asking
 * which of the two they want is asking them to remember whether they have shopped
 * here before.
 *
 * Three stages, and the order is the security of it.
 *
 * 1. **Number.** A code is sent. The response says nothing about whether the
 *    number has an account, so this screen cannot be used to find out who shops
 *    here.
 * 2. **Code.** Only now does the API say which it was — a known number is signed
 *    in outright, an unknown one comes back with a ticket.
 * 3. **Name**, asked only of somebody who has already proved the number. It is
 *    the sole field, because everything else a shop needs it can ask for at the
 *    till, where the answer is actually required.
 *
 * No password is set at any point. One would add a secret to forget without
 * adding a factor — both it and the code would live on the same handset.
 */

type Stage = 'number' | 'code' | 'name';

export function PhoneAuthForm({ next }: { next?: string }) {
  const t = useT();
  const destination = safeRedirectPath(next, '/account');

  const [stage, setStage] = React.useState<Stage>('number');
  const [phone, setPhone] = React.useState('');
  const [sentTo, setSentTo] = React.useState('');
  const [ticket, setTicket] = React.useState('');
  const [accepted, setAccepted] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resendIn, setResendIn] = React.useState(0);

  // A live countdown rather than a static "wait 60 seconds", because the one
  // thing somebody staring at an empty inbox wants to know is how much longer.
  React.useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const post = async (action: string, body: unknown) => {
    const response = await fetch(`/api/auth/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as
      | { data?: Record<string, unknown>; error?: string }
      | null;

    return { ok: response.ok, data: payload?.data, error: payload?.error };
  };

  const requestCode = async (number: string) => {
    const result = await post('phone-request', { phone: number });
    if (!result.ok) {
      setError(result.error ?? t('We could not send a code to that number.'));
      return false;
    }

    setSentTo(String(result.data?.sentTo ?? number));
    setResendIn(Number(result.data?.resendInSeconds ?? 60));
    return true;
  };

  const onNumber = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const number = String(new FormData(event.currentTarget).get('phone') ?? '').trim();
    setSubmitting(true);
    setError(null);

    try {
      if (await requestCode(number)) {
        setPhone(number);
        setStage('code');
      }
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setSubmitting(true);
    setError(null);

    try {
      const result = await post('phone-verify', { phone, code });
      if (!result.ok) {
        setError(result.error ?? t('That code is not right.'));
        setSubmitting(false);
        return;
      }

      if (result.data?.status === 'name_required') {
        setTicket(String(result.data.ticket ?? ''));
        setStage('name');
        setSubmitting(false);
        return;
      }

      // A full navigation, not `router.push` — the session cookie was just set
      // and every server component below has to re-render knowing about it.
      window.location.assign(destination);
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
      setSubmitting(false);
    }
  };

  const onName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const fullName = String(new FormData(event.currentTarget).get('fullName') ?? '').trim();
    if (!accepted) {
      setError(t('Please accept the terms to continue.'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await post('phone-register', { ticket, fullName, acceptsTerms: true });
      if (!result.ok) {
        setError(result.error ?? t('We could not finish setting up your account.'));
        setSubmitting(false);
        return;
      }

      window.location.assign(destination);
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestCode(phone);
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const message = error ? (
    <p role="alert" className="text-sm font-medium text-error">
      {error}
    </p>
  ) : null;

  if (stage === 'number') {
    return (
      <form onSubmit={onNumber} noValidate className="space-y-5">
        <Field name="phone" label={t('Mobile number')} required>
          {(props) => (
            <Input
              {...props}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01712 345678"
              defaultValue={phone}
              autoFocus
            />
          )}
        </Field>

        {message}

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {t('Send code')}
        </Button>

        <p className="text-center text-xs text-subtle">
          {t('We will text you a six-digit code. No password to remember.')}
        </p>
      </form>
    );
  }

  if (stage === 'code') {
    return (
      <form onSubmit={onCode} noValidate className="space-y-5">
        <Field name="code" label={t('Six-digit code')} required hint={t('Sent to {phone}', { phone: sentTo })}>
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              /*
               * `one-time-code` is what lets a phone offer the code from the
               * notification bar instead of making somebody switch apps, lose
               * the form and come back to a page that has forgotten their
               * number. It is the single highest-value attribute on this screen.
               */
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="text-center text-lg tracking-[0.5em]"
              autoFocus
            />
          )}
        </Field>

        {message}

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {t('Continue')}
        </Button>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              setStage('number');
              setError(null);
            }}
            className="text-muted underline-offset-2 hover:text-primary hover:underline"
          >
            {t('Use a different number')}
          </button>

          <button
            type="button"
            onClick={resend}
            disabled={resendIn > 0 || submitting}
            className="text-muted underline-offset-2 hover:text-primary hover:underline disabled:cursor-default disabled:text-subtle disabled:no-underline"
          >
            {resendIn > 0 ? t('Resend in {seconds}s', { seconds: resendIn }) : t('Resend code')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onName} noValidate className="space-y-5">
      <p className="text-sm text-muted">
        {t('Your number is confirmed. One more thing and your account is ready.')}
      </p>

      <Field name="fullName" label={t('Your name')} required>
        {(props) => <Input {...props} autoComplete="name" autoFocus />}
      </Field>

      <CheckboxField
        id="phoneAcceptsTerms"
        checked={accepted}
        onCheckedChange={(value) => setAccepted(value === true)}
        label={t.rich('I accept the {terms} and {privacy}', {
          terms: (
            <Link href="/page/terms" className="text-primary underline underline-offset-2">
              {t('terms')}
            </Link>
          ),
          privacy: (
            <Link href="/page/privacy" className="text-primary underline underline-offset-2">
              {t('privacy policy')}
            </Link>
          ),
        })}
      />

      {message}

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {t('Create my account')}
      </Button>
    </form>
  );
}
