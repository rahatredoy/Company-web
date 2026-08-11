'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { toast } from '@/components/ui/toaster';
import { useReauth } from './reauth-provider';
import { api, errorMessage } from '@/lib/api';
import type { TrialRow } from '@/lib/types';

export function TrialActions({ trial }: { trial: TrialRow }) {
  const router = useRouter();
  const { run: withReauth } = useReauth();
  const [mode, setMode] = React.useState<'extend' | 'end' | null>(null);
  const [days, setDays] = React.useState('14');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => {
    setMode(null);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'extend') {
        await withReauth(() => api.post(`/api/v1/admin/trials/${trial.id}/extend`, { days: Number(days) }));
        toast.success(`Trial extended by ${days} days`);
      } else {
        await withReauth(() => api.post(`/api/v1/admin/trials/${trial.id}/end`));
        toast.success('Trial ended');
      }
      close();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err) || null);
    } finally {
      setBusy(false);
    }
  };

  const active = trial.status === 'active';

  return (
    <>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={() => setMode('extend')} disabled={!active}>
          Extend
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMode('end')} disabled={!active}>
          End
        </Button>
      </div>

      <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === 'extend' ? 'Extend trial' : 'End trial now?'}</DialogTitle>
            <DialogDescription>
              {mode === 'extend'
                ? `Add days to ${trial.businessName}'s trial. Recorded in the audit log.`
                : `${trial.businessName}'s store is paused until they subscribe. No data is deleted.`}
            </DialogDescription>
          </DialogHeader>

          {error ? <Alert variant="danger">{error}</Alert> : null}

          {mode === 'extend' ? (
            <Field label="Additional days" htmlFor={`days-${trial.id}`} required>
              <Input
                id={`days-${trial.id}`}
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </Field>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={mode === 'end' ? 'destructive' : 'primary'}
              onClick={submit}
              loading={busy}
              disabled={mode === 'extend' && !Number(days)}
            >
              {mode === 'extend' ? 'Extend trial' : 'End trial'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
