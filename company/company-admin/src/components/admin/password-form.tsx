'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toaster';
import { ApiError, api, errorCode, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Mirrors the API rule exactly so the two can never disagree. */
const RULES = [
  { label: '12+ characters', test: (v: string) => v.length >= 12 },
  { label: 'Upper and lowercase', test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { label: 'A number', test: (v: string) => /\d/.test(v) },
  { label: 'A symbol', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(200, 'Password is too long.')
      .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
      .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
      .refine((v) => /\d/.test(v), 'Include at least one number.')
      .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type Values = z.infer<typeof schema>;

export function PasswordForm({ passwordChangedAt }: { passwordChangedAt: string | null }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';
  const met = RULES.filter((rule) => rule.test(newPassword)).length;

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/api/v1/admin/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset();
      toast.success('Password updated', { description: 'Other devices were signed out.' });
      router.refresh();
    } catch (err) {
      // Put the error where the user can act on it rather than in a banner.
      if (errorCode(err) === 'INVALID_CREDENTIALS') {
        setFieldError('currentPassword', { message: 'Your current password is incorrect.' });
        return;
      }
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const message = err.fieldError('newPassword');
        if (message) {
          setFieldError('newPassword', { message });
          return;
        }
      }
      setError(errorMessage(err) || null);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Field label="Current password" htmlFor="currentPassword" required error={errors.currentPassword?.message}>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          invalid={!!errors.currentPassword}
          {...register('currentPassword')}
        />
      </Field>

      <Field label="New password" htmlFor="newPassword" required error={errors.newPassword?.message}>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          invalid={!!errors.newPassword}
          {...register('newPassword')}
        />
      </Field>

      {newPassword ? (
        <div className="space-y-2">
          <Progress
            value={(met / RULES.length) * 100}
            className="h-1.5"
            indicatorClassName={cn(met < 2 ? 'bg-destructive' : met < RULES.length ? 'bg-warning' : 'bg-success')}
          />
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {RULES.map((rule) => {
              const ok = rule.test(newPassword);
              return (
                <li key={rule.label} className={cn('text-[10.5px]', ok ? 'text-success' : 'text-muted-foreground')}>
                  {ok ? '✓' : '○'} {rule.label}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        required
        error={errors.confirmPassword?.message}
      >
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
      </Field>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Last changed {formatDate(passwordChangedAt)}. Changing it signs out every other device.
        </p>
        <Button type="submit" loading={isSubmitting}>
          Update password
        </Button>
      </div>
    </form>
  );
}
