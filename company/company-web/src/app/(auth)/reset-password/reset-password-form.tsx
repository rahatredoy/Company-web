'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { resetPasswordSchema } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';

type Values = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [done, setDone] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const password = watch('password') ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/api/v1/public/reset-password', values);
      setDone(true);
      setTimeout(() => router.push('/sign-in'), 2000);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  if (!token) {
    return (
      <div className="space-y-5 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Invalid reset link</h1>
        <p className="text-sm text-muted-foreground">
          This link is missing its token. Request a new one and try again.
        </p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h1 className="text-2xl font-bold tracking-tight">Password updated</h1>
        <p className="text-sm text-muted-foreground">
          You have been signed out of other devices. Taking you to sign in…
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          For your security, all other sessions will be signed out.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError ? <Alert variant="danger">{formError}</Alert> : null}
        <input type="hidden" {...register('token')} />

        <Field label="New password" htmlFor="password" required error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            invalid={!!errors.password}
            {...register('password')}
          />
        </Field>
        <PasswordStrength value={password} />

        <Field
          label="Confirm new password"
          htmlFor="confirmPassword"
          required
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            invalid={!!errors.confirmPassword}
            {...register('confirmPassword')}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </div>
  );
}
