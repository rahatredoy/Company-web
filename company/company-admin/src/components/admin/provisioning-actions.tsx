'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import type { ProvisioningJob } from '@/lib/types';

/** Retry is deliberately the only action here — provisioning is not a console. */
export function ProvisioningRetry({ job }: { job: ProvisioningJob }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await api.post(`/api/v1/admin/provisioning/${job.id}/retry`);
      toast.success('Provisioning restarted', { description: `${job.businessName} is being retried.` });
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="sm"
        onClick={retry}
        loading={busy}
        disabled={job.status === 'completed' || job.status === 'creating'}
      >
        <RefreshCw /> Retry
      </Button>
    </div>
  );
}
