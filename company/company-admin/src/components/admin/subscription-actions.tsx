'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useReauth } from './reauth-provider';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import type { SubscriptionRow } from '@/lib/types';

/**
 * Row-level cancel/reactivate. These endpoints existed from the start but were
 * only reachable from a client's detail page.
 */
export function SubscriptionActions({ subscription }: { subscription: SubscriptionRow }) {
  const router = useRouter();
  const { run: withReauth } = useReauth();
  const [pending, setPending] = React.useState<'cancel' | 'reactivate' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cancellable = ['active', 'trial', 'past_due'].includes(subscription.status);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pending === 'cancel') {
        await withReauth(() => api.post(`/api/v1/admin/subscriptions/${subscription.id}/cancel`));
        toast.success('Subscription cancelled');
      } else {
        await withReauth(() => api.post(`/api/v1/admin/subscriptions/${subscription.id}/reactivate`));
        toast.success('Subscription reactivated');
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err) || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex justify-end gap-1">
        {cancellable ? (
          <Button variant="ghost" size="sm" onClick={() => setPending('cancel')}>
            <XCircle /> Cancel
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setPending('reactivate')}>
            <RefreshCw /> Reactivate
          </Button>
        )}
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending === 'cancel'
                ? `Cancel ${subscription.businessName}'s subscription?`
                : `Reactivate ${subscription.businessName}'s subscription?`}
            </DialogTitle>
            <DialogDescription>
              {pending === 'cancel'
                ? 'It stays active until the end of the paid period, then stops renewing. No data is deleted.'
                : 'Billing resumes on the next renewal date and the store comes back online.'}
            </DialogDescription>
          </DialogHeader>

          {error ? <Alert variant="danger">{error}</Alert> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Keep as is
            </Button>
            <Button
              variant={pending === 'cancel' ? 'destructive' : 'primary'}
              onClick={confirm}
              loading={busy}
            >
              {pending === 'cancel' ? 'Cancel subscription' : 'Reactivate subscription'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
