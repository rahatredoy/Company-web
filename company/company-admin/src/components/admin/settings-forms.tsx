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
import { Badge } from '@/components/ui/badge';
import { InfoList, InfoRow } from './info-row';
import { useReauth } from './reauth-provider';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import type { PlatformSettings } from '@/lib/types';

const generalSchema = z.object({
  platformName: z.string().trim().min(2, 'Enter a platform name.').max(60),
  supportEmail: z.string().trim().email('Enter a valid email address.'),
  supportPhone: z.string().trim().max(24).optional(),
  defaultCurrency: z.string().trim().length(3, 'Use a 3-letter code.').toUpperCase(),
  timezone: z.string().trim().min(3).max(64),
});

const trialSchema = z.object({
  trialDays: z.coerce.number().int().min(1, 'At least 1 day.').max(365, 'At most 365 days.'),
  reminderDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\s*,\s*\d{1,3})*$/, 'Comma-separated day counts, e.g. 10, 5, 2'),
});

const emailSchema = z.object({
  senderName: z.string().trim().min(2, 'Enter a sender name.').max(60),
  senderEmail: z.string().trim().email('Enter a valid email address.'),
});

type GeneralValues = z.infer<typeof generalSchema>;
type TrialValues = z.input<typeof trialSchema>;
type EmailValues = z.infer<typeof emailSchema>;

function useSave() {
  const router = useRouter();
  const { run: withReauth } = useReauth();
  const [error, setError] = React.useState<string | null>(null);

  const save = async (payload: unknown, successMessage: string) => {
    setError(null);
    try {
      await withReauth(() => api.put('/api/v1/admin/settings', payload));
      toast.success(successMessage);
      router.refresh();
      return true;
    } catch (err) {
      setError(errorMessage(err) || null);
      return false;
    }
  };

  return { error, save };
}

export function GeneralSettingsForm({ settings }: { settings: PlatformSettings['general'] }) {
  const { error, save } = useSave();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<GeneralValues>({
    resolver: zodResolver(generalSchema),
    defaultValues: {
      platformName: settings.platformName,
      supportEmail: settings.supportEmail,
      supportPhone: settings.supportPhone ?? '',
      defaultCurrency: settings.defaultCurrency,
      timezone: settings.timezone,
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => save({ general: values }, 'General settings saved'))} className="space-y-4" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Platform name" htmlFor="platformName" required error={errors.platformName?.message}>
          <Input id="platformName" invalid={!!errors.platformName} {...register('platformName')} />
        </Field>
        <Field label="Support email" htmlFor="supportEmail" required error={errors.supportEmail?.message}>
          <Input id="supportEmail" type="email" invalid={!!errors.supportEmail} {...register('supportEmail')} />
        </Field>
        <Field label="Support phone" htmlFor="supportPhone" error={errors.supportPhone?.message}>
          <Input id="supportPhone" {...register('supportPhone')} />
        </Field>
        <Field label="Default currency" htmlFor="defaultCurrency" required error={errors.defaultCurrency?.message}>
          <Input id="defaultCurrency" maxLength={3} className="uppercase" invalid={!!errors.defaultCurrency} {...register('defaultCurrency')} />
        </Field>
        <Field label="Timezone" htmlFor="timezone" required error={errors.timezone?.message}>
          <Input id="timezone" invalid={!!errors.timezone} {...register('timezone')} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Save general settings
        </Button>
      </div>
    </form>
  );
}

export function TrialSettingsForm({ settings }: { settings: PlatformSettings['trial'] }) {
  const { error, save } = useSave();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TrialValues>({
    resolver: zodResolver(trialSchema),
    defaultValues: {
      trialDays: settings.trialDays,
      reminderDays: settings.reminderDays.join(', '),
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) =>
        save(
          {
            trial: {
              trialDays: Number(values.trialDays),
              reminderDays: String(values.reminderDays)
                .split(',')
                .map((v) => Number(v.trim()))
                .filter((v) => Number.isFinite(v) && v > 0),
            },
          },
          'Trial settings saved',
        ),
      )}
      className="space-y-4"
      noValidate
    >
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Trial length (days)"
          htmlFor="trialDays"
          required
          error={errors.trialDays?.message}
          hint="Applies to new trials only."
        >
          <Input id="trialDays" type="number" min={1} max={365} invalid={!!errors.trialDays} {...register('trialDays')} />
        </Field>
        <Field
          label="Reminder days before expiry"
          htmlFor="reminderDays"
          required
          error={errors.reminderDays?.message}
          hint="Comma separated, e.g. 10, 5, 2"
        >
          <Input id="reminderDays" invalid={!!errors.reminderDays} {...register('reminderDays')} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Save trial settings
        </Button>
      </div>
    </form>
  );
}

export function EmailSettingsForm({ settings }: { settings: PlatformSettings['email'] }) {
  const { error, save } = useSave();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { senderName: settings.senderName, senderEmail: settings.senderEmail },
  });

  return (
    <form onSubmit={handleSubmit((values) => save({ email: values }, 'Email settings saved'))} className="space-y-4" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sender name" htmlFor="senderName" required error={errors.senderName?.message}>
          <Input id="senderName" invalid={!!errors.senderName} {...register('senderName')} />
        </Field>
        <Field label="Sender email" htmlFor="senderEmail" required error={errors.senderEmail?.message}>
          <Input id="senderEmail" type="email" invalid={!!errors.senderEmail} {...register('senderEmail')} />
        </Field>
      </div>

      <InfoList>
        <InfoRow
          label="Transport"
          value={
            <span className="inline-flex items-center gap-2">
              {settings.driver.toUpperCase()}
              <Badge variant={settings.configured ? 'success' : 'warning'}>
                {settings.configured ? 'Configured' : 'Not configured'}
              </Badge>
            </span>
          }
        />
      </InfoList>

      <p className="text-xs text-muted-foreground">
        The mail provider and its credentials live in the API&apos;s environment and are never
        editable or visible here.
      </p>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Save email settings
        </Button>
      </div>
    </form>
  );
}
