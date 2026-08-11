'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { OTP_LENGTH, OtpInput } from '@/components/auth/otp-input';
import { ApiError, api, errorMessage } from '@/lib/api';
import { adminPasswordResetSchema, type AdminPasswordResetInput } from '@/lib/validation';

/** Matches the API's resend cooldown, so the link re-enables when it will work. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Resets the store admin panel's password from the dashboard.
 *
 * The passcode goes to the admin panel's own email address, never to the account
 * signed in here — those are two separate logins by design, and this flow must
 * not become a way to take over the panel from a hijacked dashboard session. The
 * code and the new password are submitted together for the same reason.
 *
 * Every open admin panel session is signed out when it succeeds.
 */
export function AdminPasswordReset({ adminEmail }: { adminEmail: string }) {
  const [stage, setStage] = React.useState<'idle' | 'code' | 'done'>('idle');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AdminPasswordResetInput>({
    resolver: zodResolver(adminPasswordResetSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      await api.post('/api/v1/client/store/admin-password/request');
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStage('code');
      setNotice(`We sent a 6-digit code to ${adminEmail}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  const submit = handleSubmit(async (values) => {
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/v1/client/store/admin-password/reset', {
        code,
        password: values.password,
      });
      reset();
      setCode('');
      setStage('done');
    } catch (err) {
      setError(errorMessage(err));
      // A rejected code is almost always mistyped: clear the boxes so the next
      // attempt starts on the code rather than on six digits to delete.
      if (err instanceof ApiError && err.code.startsWith('OTP_')) setCode('');
    }
  });

  if (stage === 'done') {
    return (
      <Alert variant="success" title="Admin password changed">
        <p className="mb-3">
          Sign in to your admin panel as <span className="font-medium">{adminEmail}</span> with the new
          password. Any session that was already open has been signed out.
        </p>
        <Button size="sm" variant="outline" onClick={() => setStage('idle')}>
          Done
        </Button>
      </Alert>
    );
  }

  if (stage === 'idle') {
    return (
      <div className="space-y-3">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <p className="text-sm text-muted-foreground">
          Forgotten the password for your admin panel? We will email a 6-digit code to{' '}
          <span className="font-medium text-foreground">{adminEmail}</span> and let you choose a new one.
        </p>
        <Button variant="outline" onClick={() => void requestCode()} loading={sending}>
          <KeyRound /> Reset admin password
        </Button>
      </div>
    );
  }

  const codeComplete = code.length === OTP_LENGTH;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Enter the code we emailed</p>
        <OtpInput value={code} onChange={setCode} invalid={!!error} autoFocus />
      </div>

      {/* The password fields wait for the code: asking for both at once invites
          someone to type a new password before they know they can prove anything. */}
      {codeComplete ? (
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <Field
            label="New password"
            htmlFor="adminNewPassword"
            required
            error={errors.password?.message}
            hint="At least 10 characters, with a number and a symbol."
          >
            <Input
              id="adminNewPassword"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.password}
              {...register('password')}
            />
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="adminConfirmPassword"
            required
            error={errors.confirmPassword?.message}
          >
            <Input
              id="adminConfirmPassword"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.confirmPassword}
              {...register('confirmPassword')}
            />
          </Field>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void requestCode()}
          disabled={cooldown > 0 || sending}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:no-underline"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send another code'}
        </button>

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setStage('idle')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!codeComplete}>
            <Check /> Reset password
          </Button>
        </div>
      </div>
    </form>
  );
}
