'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, RefreshCw, Trash2 } from 'lucide-react';
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
import { toast } from '@/components/ui/toaster';
import { useReauth } from './reauth-provider';
import { api, errorMessage } from '@/lib/api';
import type { DomainRow } from '@/lib/types';

export function DomainActions({ domain }: { domain: DomainRow }) {
  const router = useRouter();
  const { run: withReauth } = useReauth();
  const [pending, setPending] = React.useState<'disable' | 'remove' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const managed = domain.domainType === 'platform_subdomain';

  const verify = async () => {
    setBusy(true);
    try {
      const result = await api.post<DomainRow>(`/api/v1/admin/domains/${domain.id}/verify`);
      toast[result.verified ? 'success' : 'warning'](
        result.verified ? 'Domain verified' : 'DNS records do not match yet',
      );
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pending === 'disable') {
        await withReauth(() => api.post(`/api/v1/admin/domains/${domain.id}/disable`));
        toast.success('Domain disabled');
      } else {
        await withReauth(() => api.delete(`/api/v1/admin/domains/${domain.id}`));
        toast.success('Domain removed');
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
        <Button variant="ghost" size="sm" onClick={verify} disabled={managed || busy}>
          <RefreshCw /> Verify
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Disable ${domain.domain}`}
          onClick={() => setPending('disable')}
          disabled={managed || domain.status === 'disabled'}
        >
          <Ban />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${domain.domain}`}
          onClick={() => setPending('remove')}
          disabled={managed}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending === 'disable' ? `Disable ${domain.domain}?` : `Remove ${domain.domain}?`}
            </DialogTitle>
            <DialogDescription>
              {pending === 'disable'
                ? 'The storefront stops answering on this domain. The platform subdomain keeps working.'
                : 'The domain is detached from this client. They can add it again later.'}
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} loading={busy}>
              {pending === 'disable' ? 'Disable domain' : 'Remove domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
