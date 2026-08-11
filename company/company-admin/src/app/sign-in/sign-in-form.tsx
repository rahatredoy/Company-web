'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MailCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OTP_LENGTH, OtpInput } from '@/components/auth/otp-input';
import { api, errorCode, errorMessage } from '@/lib/api';

const credentialsSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email.'),
});

/** What the API is sent, whatever the clipboard carried in with the code. */
const digitsOnly = (raw: string) => raw.replace(/\D/g, '').slice(0, OTP_LENGTH);

type CredentialsValues = z.input<typeof credentialsSchema>;
type CodeValues = z.input<typeof codeSchema>;

type Stage = 'credentials' | 'code';

type LoginResponse =
  | { otpRequired: true; sentTo: string; expiresAt: string }
  /** This browser is already remembered — the API signed us in outright. */
  | { otpRequired: false; expiresAt: string };

/**
 * Two-step sign-in: password, then a passcode emailed to the administrator.
 *
 * The password alone never produces a usable session — the API issues a
 * short-lived challenge and only the passcode promotes it, so a leaked password
 * is not by itself a way into the platform.
 *
 * The exception is a browser that cleared a passcode recently: it holds a
 * device token the API recognises, which stands in for the code until the trust
 * window lapses. The API decides that, not this form — hence `otpRequired`.
 */
export function AdminSignInForm({
  nextPath,
  notice: initialNotice,
  initialStage = 'credentials',
  pendingEmail,
}: {
  nextPath?: string;
  notice?: string;
  initialStage?: Stage;
  pendingEmail?: string;
}) {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>(initialStage);
  const [sentTo, setSentTo] = React.useState<string | undefined>(pendingEmail);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(initialNotice ?? null);

  const credentialsForm = useForm<CredentialsValues>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });

  const codeValue = codeForm.watch('code') ?? '';

  function done() {
    router.replace(nextPath ?? '/dashboard');
    router.refresh();
  }

  async function submitCredentials(values: CredentialsValues) {
    setFormError(null);
    setNotice(null);
    try {
      const result = await api.post<LoginResponse>('/api/v1/admin/login', values);

      if (result && result.otpRequired === false) {
        done();
        return;
      }

      setSentTo(result?.sentTo);
      setStage('code');
      codeForm.reset({ code: '' });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function submitCode(values: CodeValues) {
    setFormError(null);
    setNotice(null);
    try {
      await api.post('/api/v1/admin/otp/verify', { code: digitsOnly(values.code) });
      done();
    } catch (error) {
      const code = errorCode(error);

      // The challenge is gone — the only honest move is to start over rather
      // than leave the user typing codes at a session that no longer exists.
      if (code === 'OTP_TOO_MANY_ATTEMPTS' || code === 'SESSION_EXPIRED') {
        setStage('credentials');
        credentialsForm.reset();
      }

      // A rejected code is almost always mistyped or stale: empty the boxes so
      // the next code can be pasted straight in.
      codeForm.setValue('code', '', { shouldValidate: false });
      setFormError(errorMessage(error));
    }
  }

  // The last box being filled — by typing or by paste — is the whole answer, so
  // the form goes then rather than waiting for a click that adds nothing.
  const submitFilledCode = codeForm.handleSubmit(submitCode);

  async function resend() {
    setFormError(null);
    setNotice(null);
    try {
      const result = await api.post<{ sentTo: string }>('/api/v1/admin/otp/resend');
      setSentTo(result?.sentTo);
      codeForm.setValue('code', '', { shouldValidate: false });
      setNotice('A new code is on its way.');
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  if (stage === 'code') {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
            <MailCheck className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {sentTo ? (
              <>
                We sent a 6-digit code to <span className="font-medium text-foreground">{sentTo}</span>.
              </>
            ) : (
              'We sent a 6-digit code to your email address.'
            )}
          </p>
        </div>

        <form onSubmit={submitFilledCode} className="space-y-4" noValidate>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          {notice ? <Alert variant="success">{notice}</Alert> : null}

          <Field label="Sign-in code" htmlFor="code" required error={codeForm.formState.errors.code?.message}>
            <OtpInput
              id="code"
              value={codeValue}
              onChange={(next) => codeForm.setValue('code', next, { shouldValidate: false })}
              onComplete={() => void submitFilledCode()}
              invalid={!!codeForm.formState.errors.code}
              disabled={codeForm.formState.isSubmitting}
              autoFocus
            />
          </Field>

          <Button
            type="submit"
            className="w-full"
            disabled={codeForm.formState.isSubmitting || codeValue.length !== OTP_LENGTH}
          >
            {codeForm.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            Verify and sign in
          </Button>

          <div className="flex flex-col gap-1 text-center text-sm">
            <button
              type="button"
              onClick={() => void resend()}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Didn&apos;t get it? Send another code
            </button>
            <button
              type="button"
              onClick={() => {
                setStage('credentials');
                setFormError(null);
                setNotice(null);
              }}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Start over
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          If we don&apos;t recognise this browser, we will email you a code to finish signing in.
        </p>
      </div>

      <form onSubmit={credentialsForm.handleSubmit(submitCredentials)} className="space-y-4" noValidate>
        {notice ? <Alert variant="warning">{notice}</Alert> : null}
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Field
          label="Email address"
          htmlFor="email"
          required
          error={credentialsForm.formState.errors.email?.message}
        >
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            placeholder="admin@company.com"
            {...credentialsForm.register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          error={credentialsForm.formState.errors.password?.message}
        >
          <Input id="password" type="password" autoComplete="current-password" {...credentialsForm.register('password')} />
        </Field>

        <Button type="submit" className="w-full" disabled={credentialsForm.formState.isSubmitting}>
          {credentialsForm.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Continue
        </Button>
      </form>
    </div>
  );
}
