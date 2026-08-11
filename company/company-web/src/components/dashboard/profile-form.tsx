'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { toast } from '@/components/ui/toaster';
import { profileSchema } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';
import type { ClientMe } from '@/lib/types';

type Values = z.infer<typeof profileSchema>;

export function ProfileForm({ account }: { account: ClientMe }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: account.fullName, phone: account.phone ?? '' },
  });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.put('/api/v1/client/profile', values);
      toast.success('Profile updated');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Field label="Full name" htmlFor="fullName" required error={errors.fullName?.message}>
        <Input id="fullName" autoComplete="name" invalid={!!errors.fullName} {...register('fullName')} />
      </Field>

      <Field label="Phone number" htmlFor="phone" required error={errors.phone?.message}>
        <Input id="phone" type="tel" autoComplete="tel" invalid={!!errors.phone} {...register('phone')} />
      </Field>

      <Field
        label="Email address"
        htmlFor="email"
        hint="Contact support if you need to change the email on your account."
      >
        <Input id="email" value={account.email} disabled readOnly />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
