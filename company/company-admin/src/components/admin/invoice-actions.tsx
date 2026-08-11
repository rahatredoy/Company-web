'use client';

import * as React from 'react';
import { Download, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { publicEnv } from '@/lib/env';

export function InvoiceActions({ invoiceId }: { invoiceId: string }) {
  const [sending, setSending] = React.useState(false);

  const send = async () => {
    setSending(true);
    try {
      await api.post(`/api/v1/admin/invoices/${invoiceId}/send`);
      toast.success('Invoice emailed to the client');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex justify-end gap-1">
      <Button asChild variant="ghost" size="sm">
        <a
          href={`${publicEnv.apiUrl}/api/v1/admin/invoices/${invoiceId}/download`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Download /> Download
        </a>
      </Button>
      <Button variant="ghost" size="sm" onClick={send} loading={sending}>
        <Mail /> Send
      </Button>
    </div>
  );
}
