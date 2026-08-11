'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { forgotPasswordSchema } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // The API always answers 200 here so account existence is never leaked.
      await api.post('/api/v1/public/forgot-password', values);
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  if (sent) {
    return (
      <div className="space-y-6 text-center">
        <MailCheck className="mx-auto size-12 text-primary" aria-hidden />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Check your inbox</h1>
          <p className="text-sm text-muted-foreground">
            If an account exists for{' '}
            <span className="font-medium text-foreground">{getValues('email')}</span>, we have sent a
            password reset link. It expires in one hour.
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter the email you registered with and we will send you a reset link.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
