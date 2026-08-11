'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { OtpStep } from '@/components/auth/otp-step';
import { api, errorCode, errorMessage } from '@/lib/api';

/**
 * Account activation by emailed passcode.
 *
 * Entering the code proves the same two things a sign-in does — the password
 * chosen moments ago and control of the inbox — so the API signs the new
 * customer in as part of accepting it, and onboarding starts immediately.
 */
export function VerifyEmailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = searchParams.get('email');

  const [verified, setVerified] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function submitCode(code: string) {
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/v1/public/verify-email', { email, code });
      setVerified(true);
      // The dashboard decides what is missing — plan, payment or store — so a
      // freshly verified account and a returning one land in the same place.
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      // Already activated: the code is spent, but the account is fine — say so
      // and send them to sign in rather than showing a bare failure.
      if (errorCode(err) === 'EMAIL_ALREADY_VERIFIED') {
        router.push('/sign-in');
        return;
      }
      setError(errorMessage(err, 'That code is not correct or has expired.'));
    }
  }

  async function resendCode() {
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/v1/public/resend-verification', { email });
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Without an address there is nothing to verify against — the code alone does
  // not identify an account.
  if (!email) {
    return (
      <div className="space-y-5 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Verify your email</h1>
        <p className="text-sm text-muted-foreground">
          Open this page from the link on the sign-in screen, or sign in to have a new code sent.
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h1 className="text-2xl font-bold tracking-tight">Email verified</h1>
        <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
        <Button asChild className="w-full">
          <Link href="/dashboard">Go to my dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <OtpStep
        title="Check your inbox"
        description={
          <>
            We sent a 6-digit verification code to{' '}
            <span className="font-medium text-foreground">{email}</span>. Enter it below to activate your
            account.
          </>
        }
        submitLabel="Verify and continue"
        onSubmit={submitCode}
        onResend={resendCode}
        error={error}
        notice={notice}
      />

      <Alert variant="info">
        The code expires in 30 minutes. Check your spam folder if it does not arrive within a few minutes.
      </Alert>

      <p className="text-center text-sm text-muted-foreground">
        Wrong address?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Register again
        </Link>
      </p>
    </div>
  );
}
