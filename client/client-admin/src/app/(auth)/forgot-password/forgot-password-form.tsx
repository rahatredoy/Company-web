'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MailCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
});

type Values = z.input<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await api.post('/api/v1/admin/auth/forgot-password', values);
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  if (sent) {
    return (
      <Card className="shadow-[var(--shadow-raised)]">
        <CardHeader>
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-success-soft text-success">
            <MailCheck className="size-5" />
          </span>
          <CardTitle>Check your email</CardTitle>
          {/* Never confirms whether the address has an account. */}
          <CardDescription>
            If that address has an account, a reset link is on its way. It expires in 60 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-[var(--shadow-raised)]">
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>We will email you a link to choose a new one.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}

          <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="username" autoFocus {...form.register('email')} />
          </Field>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
      </CardContent>

      <div className="border-t border-border px-6 py-4 text-center text-sm text-muted-foreground">
        <Link href="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    </Card>
  );
}
