'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorCode, errorMessage } from '@/lib/api';
import type { SessionResponse } from '@/lib/types';

const signInSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean().default(false),
});

type SignInValues = z.input<typeof signInSchema>;

export function SignInForm({ mfaPending }: { mfaPending: boolean }) {
  const router = useRouter();
  const [stage, setStage] = React.useState<'password' | 'mfa'>(mfaPending ? 'mfa' : 'password');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notReady, setNotReady] = React.useState(false);

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '', remember: false },
  });

  async function onSubmit(values: SignInValues) {
    setFormError(null);
    setNotReady(false);
    try {
      const session = await api.post<SessionResponse>('/api/v1/admin/auth/login', values);
      if (!session.authenticated && session.mfaRequired) {
        setStage('mfa');
        return;
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      // An account without a password is a provisioning problem, not a wrong
      // password — there is nothing the visitor can do here to fix it.
      if (errorCode(error) === 'ACCOUNT_NOT_READY') setNotReady(true);
      setFormError(errorMessage(error));
    }
  }

  if (stage === 'mfa') {
    return <MfaForm onBack={() => setStage('password')} />;
  }

  return (
    <Card className="shadow-[var(--shadow-raised)]">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use the email address and password your store was registered with.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {formError ? (
            <Alert variant="danger" title={notReady ? 'Account not ready' : 'Could not sign in'}>
              {formError}
            </Alert>
          ) : null}

          <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="you@yourstore.com"
              {...form.register('email')}
            />
          </Field>

          <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>

          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox
                checked={form.watch('remember')}
                onCheckedChange={(checked) => form.setValue('remember', checked === true)}
              />
              Keep me signed in
            </Label>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            Sign in
          </Button>
        </form>
      </CardContent>

      {/* No sign-up, no invite: this panel has exactly one account, created when
          the store was registered. Anything else belongs to the company site. */}
      <div className="border-t border-border px-6 py-4 text-center text-sm text-muted-foreground">
        This panel has one admin account — the one your store was registered with.
      </div>
    </Card>
  );
}

const mfaSchema = z.object({
  code: z.string().trim().min(6, 'Enter the code from your authenticator app.'),
  remember: z.boolean().default(false),
});

type MfaValues = z.input<typeof mfaSchema>;

function MfaForm({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<MfaValues>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: '', remember: false },
  });

  async function onSubmit(values: MfaValues) {
    setFormError(null);
    try {
      await api.post<SessionResponse>('/api/v1/admin/auth/mfa/verify', values);
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <Card className="shadow-[var(--shadow-raised)]">
      <CardHeader>
        <span className="mb-3 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
          <KeyRound className="size-5" />
        </span>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}

          <Field label="Authentication code" htmlFor="code" error={form.formState.errors.code?.message}>
            <Input
              id="code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              className="text-center font-mono text-lg tracking-[0.35em]"
              {...form.register('code')}
            />
          </Field>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            Verify and continue
          </Button>

          <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
            Use a different account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
