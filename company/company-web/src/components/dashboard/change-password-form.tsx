'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { toast } from '@/components/ui/toaster';
import { changePasswordSchema } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';

type Values = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/api/v1/client/password', values);
      reset();
      toast.success('Password updated', { description: 'Other sessions have been signed out.' });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Field label="Current password" htmlFor="currentPassword" required error={errors.currentPassword?.message}>
        <PasswordInput
          id="currentPassword"
          autoComplete="current-password"
          invalid={!!errors.currentPassword}
          {...register('currentPassword')}
        />
      </Field>

      <Field label="New password" htmlFor="newPassword" required error={errors.newPassword?.message}>
        <PasswordInput
          id="newPassword"
          autoComplete="new-password"
          invalid={!!errors.newPassword}
          {...register('newPassword')}
        />
      </Field>
      <PasswordStrength value={newPassword} />

      <Field label="Confirm new password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Update password
        </Button>
      </div>
    </form>
  );
}
