'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

/**
 * The staff note on an order.
 *
 * Never returned by any storefront endpoint, which is what makes it usable for
 * the things that actually need writing down — "customer phoned, wants it left
 * with the neighbour", "second attempt, card declined". The customer's own note
 * is shown separately and is not editable here; conflating the two would put
 * internal wording in front of whoever placed the order.
 */
export function OrderNote({
  orderId,
  note,
  canUpdate,
}: {
  orderId: string;
  note: string | null;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(note ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const dirty = value !== (note ?? '');

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      await api.patch(`/api/v1/admin/orders/${orderId}/note`, { adminNote: value.trim() || null });
      toast.success('Note saved.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (!canUpdate) {
    return note ? (
      <Card>
        <CardHeader>
          <CardTitle>Staff note</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{note}</p>
        </CardContent>
      </Card>
    ) : null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff note</CardTitle>
        <CardDescription>Only ever seen here — never by the customer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Anything the next person handling this order should know."
          aria-label="Staff note"
        />

        <div className="flex justify-end">
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save note
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
