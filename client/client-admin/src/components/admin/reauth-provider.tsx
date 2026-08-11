'use client';

import * as React from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ReauthCancelledError, api, errorCode, errorMessage } from '@/lib/api';

interface ReauthContextValue {
  /**
   * Runs `action`. If it fails with REAUTH_REQUIRED, prompts for the admin's
   * password (and second factor), then retries the action exactly once.
   * Rejects with ReauthCancelledError if the prompt is dismissed.
   */
  run: <T>(action: () => Promise<T>) => Promise<T>;
  /** Imperative prompt. Resolves true once identity is confirmed. */
  confirm: () => Promise<boolean>;
}

const ReauthContext = React.createContext<ReauthContextValue | null>(null);

export function useReauth(): ReauthContextValue {
  const context = React.useContext(ReauthContext);
  if (!context) throw new Error('useReauth must be used inside <ReauthProvider>.');
  return context;
}

type Step = 'password' | 'mfa' | 'recovery';

export function ReauthProvider({
  mfaEnabled,
  children,
}: {
  mfaEnabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>('password');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [recovery, setRecovery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // The pending confirm() promise is parked here until the dialog settles.
  const resolverRef = React.useRef<((confirmed: boolean) => void) | null>(null);

  const settle = React.useCallback((confirmed: boolean) => {
    setOpen(false);
    setPassword('');
    setCode('');
    setRecovery('');
    setError(null);
    setBusy(false);
    setStep('password');
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
  }, []);

  const confirm = React.useCallback(() => {
    setStep('password');
    setError(null);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const run = React.useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (errorCode(error) !== 'REAUTH_REQUIRED') throw error;
        if (!(await confirm())) throw new ReauthCancelledError();
        // Exactly one retry — a second REAUTH_REQUIRED surfaces as a real error
        // rather than looping the prompt forever.
        return await action();
      }
    },
    [confirm],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body: { password: string; code?: string; recoveryCode?: string } = { password };
    if (step === 'recovery') body.recoveryCode = recovery.trim().toUpperCase();
    else if (mfaEnabled || step === 'mfa') body.code = code.trim();

    try {
      await api.post('/api/v1/admin/auth/reauth', body);
      settle(true);
    } catch (err) {
      const codeValue = errorCode(err);

      if (codeValue === 'MFA_REQUIRED') {
        // MFA was turned on elsewhere since this page loaded.
        setStep('mfa');
        setError('Enter the code from your authenticator app to continue.');
      } else if (codeValue === 'MFA_INVALID') {
        setCode('');
        setError('That code was not accepted. Codes rotate every 30 seconds.');
      } else if (codeValue === 'INVALID_CREDENTIALS') {
        setPassword('');
        setError('Your password is incorrect.');
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  const value = React.useMemo<ReauthContextValue>(() => ({ run, confirm }), [run, confirm]);

  const needsCode = step === 'mfa' || (step === 'password' && mfaEnabled);

  return (
    <ReauthContext.Provider value={value}>
      {children}

      <Dialog open={open} onOpenChange={(next) => !next && settle(false)}>
        {/* Stacks above the action's own confirm dialog, which stays open
            behind it so cancelling returns the user exactly where they were. */}
        <DialogContent className="z-60" overlayClassName="z-60">
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {step === 'recovery' ? (
                  <KeyRound className="size-5 text-primary" aria-hidden />
                ) : (
                  <ShieldCheck className="size-5 text-primary" aria-hidden />
                )}
                Confirm your identity
              </DialogTitle>
              <DialogDescription>
                This action is protected. Re-enter your password to continue.
              </DialogDescription>
            </DialogHeader>

            <div className="my-5 space-y-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <Field label="Password" htmlFor="reauth-password" required>
                <Input
                  id="reauth-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </Field>

              {needsCode ? (
                <Field label="Authentication code" htmlFor="reauth-code" required>
                  <Input
                    id="reauth-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    className="text-center font-mono text-lg tracking-[0.4em]"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              ) : null}

              {step === 'recovery' ? (
                <Field label="Recovery code" htmlFor="reauth-recovery" required>
                  <Input
                    id="reauth-recovery"
                    placeholder="XXXX-XXXX-XXXX"
                    className="text-center font-mono tracking-widest uppercase"
                    value={recovery}
                    onChange={(event) => setRecovery(event.target.value.toUpperCase())}
                  />
                </Field>
              ) : null}

              {mfaEnabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep(step === 'recovery' ? 'mfa' : 'recovery');
                  }}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  {step === 'recovery' ? 'Use your authenticator app instead' : 'Lost your device? Use a recovery code'}
                </button>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => settle(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!password}>
                Confirm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ReauthContext.Provider>
  );
}
