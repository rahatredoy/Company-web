'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useT, type Translator } from '@/lib/i18n';

/** Built per render language, so a validation message is in the store's language. */
const resetSchema = (t: Translator) =>
  z
    .object({
      password: z
        .string()
        .min(10, t('Use at least 10 characters.'))
        .max(200, t('That password is too long.'))
        .refine((v) => /[a-z]/.test(v), t('Include a lowercase letter.'))
        .refine((v) => /[A-Z]/.test(v), t('Include an uppercase letter.'))
        .refine((v) => /[0-9]/.test(v), t('Include a number.')),
      confirmPassword: z.string().min(1, t('Confirm your password.')),
    })
    .refine((value) => value.password === value.confirmPassword, {
      message: t('Passwords do not match.'),
      path: ['confirmPassword'],
    });

type Values = z.input<ReturnType<typeof resetSchema>>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const t = useT();
  const schema = React.useMemo(() => resetSchema(t), [t]);
  const [done, setDone] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  if (!token) {
    return (
      <Card className="shadow-[var(--shadow-raised)]">
        <CardHeader>
          <CardTitle>{t('This link is incomplete')}</CardTitle>
          <CardDescription>{t('Open the link from your email, or request a new one.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">{t('Request a new link')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await api.post('/api/v1/admin/auth/reset-password', { token, ...values });
      setDone(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  if (done) {
    return (
      <Card className="shadow-[var(--shadow-raised)]">
        <CardHeader>
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-success-soft text-success">
            <CheckCircle2 className="size-5" />
          </span>
          <CardTitle>{t('Password changed')}</CardTitle>
          {/* A reset is how a compromise is undone, so every device is signed out. */}
          <CardDescription>
            {t('Every device has been signed out. Sign in again with your new password.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.replace('/sign-in')}>
            {t('Go to sign in')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-[var(--shadow-raised)]">
      <CardHeader>
        <CardTitle>{t('Choose a new password')}</CardTitle>
        <CardDescription>{t('Pick something you have not used on this store before.')}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}

          <Field
            label={t('New password')}
            htmlFor="password"
            hint={t('At least 10 characters, with an uppercase letter and a number.')}
            error={form.formState.errors.password?.message}
          >
            <Input id="password" type="password" autoComplete="new-password" autoFocus {...form.register('password')} />
          </Field>

          <Field
            label={t('Confirm password')}
            htmlFor="confirmPassword"
            error={form.formState.errors.confirmPassword?.message}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </Field>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {t('Change password')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
