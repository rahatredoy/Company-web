'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { SubscriberRow } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';

/**
 * Taking somebody off the mailing list.
 *
 * Marked unsubscribed, never deleted — the API refuses to do otherwise. A
 * deleted row means the next signup form or import silently re-adds them, and
 * "please stop emailing me" is the one instruction a mailing list must not lose.
 */
export function SubscriberActions({
  subscriber,
  canManage,
}: {
  subscriber: SubscriberRow;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  if (!canManage || subscriber.status === 'unsubscribed') return null;

  const onUnsubscribe = async () => {
    if (!window.confirm(`Unsubscribe ${subscriber.email}?`)) return;

    setBusy(true);

    try {
      await api.delete(`/api/v1/admin/newsletter/${subscriber.id}`);
      toast.success('Unsubscribed.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={onUnsubscribe}>
      Unsubscribe
    </Button>
  );
}
