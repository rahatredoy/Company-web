'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';

export function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const markAll = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/admin/notifications/read-all');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={markAll} loading={busy}>
      <CheckCheck /> Mark all read
    </Button>
  );
}
