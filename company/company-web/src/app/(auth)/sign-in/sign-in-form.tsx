'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { PasswordInput } from '@/components/auth/password-input';
import { OtpStep } from '@/components/auth/otp-step';
import { loginSchema, type LoginInput } from '@/lib/validation';
import { api, errorCode, errorMessage } from '@/lib/api';
import type { ClientMe } from '@/lib/types';

interface LoginResponse {
  otpRequired: true;
  sentTo: string;
  expiresAt: string;
}

/**
 * `next` arrives in the query string, so it is whatever the link that sent the
 * visitor here said. Only a same-site path is followed — `//host` and `/\host`
 * are protocol-relative to a browser, so signing in would land offsite.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/dashboard';
  }
  return value;
}

/**
 * Two-step sign-in: password, then the passcode emailed to the account.
 *
 * The password alone never produces a session — the API answers with a
 * short-lived challenge and only the passcode promotes it, so a leaked password
 * is not by itself a way into someone's store.
 */
export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stage, setStage] = React.useState<'credentials' | 'code'>('credentials');
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [codeNotice, setCodeNotice] = React.useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = React.useState<string | null>(null);
  const [signedInAs, setSignedInAs] = React.useState<string | null>(null);

  const nextPath = searchParams.get('next');

  /**
   * Someone can reach this page with a session already live — an old link, the
   * back button, a second tab. The page still signs them in (the session cookie
   * is HttpOnly, so only the API can say whether it is worth anything), but it
   * offers the shorter way through once the API confirms there is an account
   * behind the cookie.
   */
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await api.get<ClientMe>('/api/v1/client/me');
        if (!cancelled && me) setSignedInAs(me.email);
      } catch {
        // Not signed in — the form is the whole page, which is the common case.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  });

  const remember = watch('remember');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setUnverifiedEmail(null);
    try {
      const result = await api.post<LoginResponse>('/api/v1/public/login', values);
      setSentTo(result?.sentTo ?? null);
      setCodeError(null);
      setCodeNotice(null);
      setStage('code');
    } catch (error) {
      // The account exists but was never activated — the API has just sent a
      // fresh activation code, so point at the page that accepts it.
      if (errorCode(error) === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(values.email);
        return;
      }
      setFormError(errorMessage(error));
    }
  });

  function backToCredentials(message: string | null) {
    setStage('credentials');
    setSentTo(null);
    setCodeError(null);
    setCodeNotice(null);
    setFormError(message);
  }

  async function submitCode(code: string) {
    setCodeError(null);
    setCodeNotice(null);
    try {
      await api.post('/api/v1/public/login/otp/verify', { code });

      // Always the dashboard, in this tab. It knows whether a plan or a store
      // exists and asks for whatever is missing — signing in should never dump
      // someone straight into a wizard they did not ask for, and never leave
      // them on the sign-in page wondering whether it worked.
      //
      // `replace`, not `push`: the sign-in page is finished with, and going
      // back to it after signing in only shows the form again.
      const target = safeNext(nextPath);
      router.replace(target);
      router.refresh();
    } catch (error) {
      const code = errorCode(error);

      // The challenge is gone. Leaving the user typing codes at a session that
      // no longer exists would only produce more failures.
      if (code === 'OTP_TOO_MANY_ATTEMPTS' || code === 'SESSION_EXPIRED' || code === 'UNAUTHORIZED') {
        backToCredentials(errorMessage(error));
        return;
      }

      setCodeError(errorMessage(error));
    }
  }

  async function resendCode() {
    setCodeError(null);
    setCodeNotice(null);
    try {
      const result = await api.post<{ sentTo: string }>('/api/v1/public/login/otp/resend');
      if (result?.sentTo) setSentTo(result.sentTo);
      setCodeNotice('A new code is on its way.');
    } catch (error) {
      if (errorCode(error) === 'SESSION_EXPIRED') {
        backToCredentials(errorMessage(error));
        return;
      }
      setCodeError(errorMessage(error));
    }
  }

  if (stage === 'code') {
    return (
      <OtpStep
        title="Check your email"
        description={
          sentTo ? (
            <>
              We sent a 6-digit sign-in code to <span className="font-medium text-foreground">{sentTo}</span>.
              It expires in a few minutes.
            </>
          ) : (
            'We sent a 6-digit sign-in code to your email address. It expires in a few minutes.'
          )
        }
        submitLabel="Verify and sign in"
        onSubmit={submitCode}
        onResend={resendCode}
        error={codeError}
        notice={codeNotice}
        secondaryAction={{ label: 'Use a different account', onClick: () => backToCredentials(null) }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {signedInAs ? (
        <Alert variant="info" title="You are already signed in">
          <span className="font-medium text-foreground">{signedInAs}</span> has an open session.{' '}
          <Link href={safeNext(nextPath)} className="font-medium text-primary hover:underline">
            Go to the dashboard
          </Link>
          , or sign in below with a different account.
        </Alert>
      ) : null}

      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      {unverifiedEmail ? (
        <Alert variant="warning" title="Verify your email first">
          We sent a 6-digit verification code to {unverifiedEmail}.{' '}
          <Link
            href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
            className="font-medium text-primary hover:underline"
          >
            Enter it here
          </Link>
        </Alert>
      ) : null}

      <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
      </Field>

      <Field label="Password" htmlFor="password" required error={errors.password?.message}>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          invalid={!!errors.password}
          {...register('password')}
        />
      </Field>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={!!remember}
            onCheckedChange={(checked) => setValue('remember', checked === true)}
          />
          <label htmlFor="remember" className="text-sm text-muted-foreground">
            Keep me signed in
          </label>
        </div>
        <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Continue
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        We will email you a 6-digit code to finish signing in.
      </p>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
