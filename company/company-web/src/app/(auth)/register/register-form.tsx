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
import { PasswordStrength } from '@/components/auth/password-strength';
import { registerSchema, type RegisterInput } from '@/lib/validation';
import { ApiError, api, errorMessage } from '@/lib/api';

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = React.useState<string | null>(null);

  const planCode = searchParams.get('plan');
  const cycle = searchParams.get('cycle');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  const password = watch('password') ?? '';
  const acceptTerms = watch('acceptTerms');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/api/v1/public/register', {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        password: values.password,
        acceptTerms: values.acceptTerms,
        ...(planCode ? { planCode } : {}),
        ...(cycle ? { billingCycle: cycle } : {}),
      });

      // The account is inert until the emailed code is entered, so registration
      // ends on the verification step rather than on a "check your email" dead end.
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      if (error instanceof ApiError && error.details) {
        for (const [field, messages] of Object.entries(error.details)) {
          if (field in values && messages[0]) {
            setError(field as keyof RegisterInput, { message: messages[0] });
          }
        }
      }
      setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      <Field label="Full name" htmlFor="fullName" required error={errors.fullName?.message}>
        <Input id="fullName" autoComplete="name" invalid={!!errors.fullName} {...register('fullName')} />
      </Field>

      <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
      </Field>

      <Field
        label="Phone number"
        htmlFor="phone"
        required
        error={errors.phone?.message}
        hint="Include your country code, e.g. +8801712345678"
      >
        <Input id="phone" type="tel" autoComplete="tel" invalid={!!errors.phone} {...register('phone')} />
      </Field>

      <Field label="Password" htmlFor="password" required error={errors.password?.message}>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          invalid={!!errors.password}
          {...register('password')}
        />
      </Field>
      <PasswordStrength value={password} />

      <Field label="Confirm password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="acceptTerms"
            checked={!!acceptTerms}
            onCheckedChange={(checked) =>
              setValue('acceptTerms', checked === true, { shouldValidate: true })
            }
            className="mt-0.5"
          />
          <label htmlFor="acceptTerms" className="text-sm text-muted-foreground">
            I agree to the{' '}
            <Link href="/legal/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </label>
        </div>
        {errors.acceptTerms ? (
          <p className="text-xs text-destructive" role="alert">
            {errors.acceptTerms.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
