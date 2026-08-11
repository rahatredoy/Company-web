'use client';

import * as React from 'react';
import { MailCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { OTP_LENGTH, OtpInput } from './otp-input';

/** Matches the server's resend cooldown, so the button re-enables when it will work. */
const RESEND_COOLDOWN_SECONDS = 60;

interface OtpStepProps {
  title: string;
  description: React.ReactNode;
  submitLabel: string;
  /** Rejects with an ApiError; the caller decides what the message should say. */
  onSubmit: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  error?: string | null;
  notice?: string | null;
  /** "Start over" / "wrong address" escape hatch under the resend link. */
  secondaryAction?: { label: string; onClick: () => void };
}

/**
 * The passcode half of a two-step flow: sign-in and account activation both end
 * here, so both get the same input, the same cooldown and the same wording.
 *
 * State lives with the caller because the two flows disagree about what an error
 * means — a burned sign-in challenge sends the user back to the password form,
 * while a burned activation code only needs a new code.
 */
export function OtpStep({
  title,
  description,
  submitLabel,
  onSubmit,
  onResend,
  error,
  notice,
  secondaryAction,
}: OtpStepProps) {
  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  // The code was sent moments before this step rendered, so the cooldown starts
  // already running rather than inviting a resend the server would refuse.
  const [cooldown, setCooldown] = React.useState(RESEND_COOLDOWN_SECONDS);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // A rejected code is almost always mistyped, so clear the boxes and let the
  // user start typing again instead of making them delete six digits first.
  const previousError = React.useRef(error);
  React.useEffect(() => {
    if (error && error !== previousError.current) setCode('');
    previousError.current = error;
  }, [error]);

  async function submit(value: string) {
    if (value.length !== OTP_LENGTH || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await onResend();
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
        className="space-y-5"
        noValidate
      >
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(value) => void submit(value)}
          invalid={!!error}
          disabled={submitting}
          autoFocus
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={code.length !== OTP_LENGTH}
        >
          {submitLabel}
        </Button>
      </form>

      <div className="space-y-1.5 text-center text-sm">
        <p className="text-muted-foreground">
          Didn&apos;t get the email?{' '}
          <button
            type="button"
            onClick={() => void resend()}
            disabled={cooldown > 0 || resending}
            className="font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? 'Sending…' : 'Send another code'}
          </button>
        </p>

        {secondaryAction ? (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {secondaryAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
