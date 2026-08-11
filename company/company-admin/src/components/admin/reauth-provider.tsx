'use client';

import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
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

/**
 * Confirms identity before a sensitive action.
 *
 * Password only. Sign-in already proved possession of the email account with a
 * one-time passcode; re-sending a code for every settings change would train
 * the administrator to approve codes reflexively, which is precisely the habit
 * that makes passcode phishing work.
 */
export function ReauthProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // The pending confirm() promise is parked here until the dialog settles.
  const resolverRef = React.useRef<((confirmed: boolean) => void) | null>(null);

  const settle = React.useCallback((confirmed: boolean) => {
    setOpen(false);
    setPassword('');
    setError(null);
    setBusy(false);
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
  }, []);

  const confirm = React.useCallback(() => {
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

    try {
      await api.post('/api/v1/admin/reauth', { password });
      settle(true);
    } catch (err) {
      const codeValue = errorCode(err);

      if (codeValue === 'INVALID_CREDENTIALS') {
        setPassword('');
        setError('Your password is incorrect.');
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  const value = React.useMemo<ReauthContextValue>(() => ({ run, confirm }), [run, confirm]);


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
                <ShieldCheck className="size-5 text-primary" aria-hidden />
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
