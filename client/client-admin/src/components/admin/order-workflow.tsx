'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Truck } from 'lucide-react';
import type { OrderDetailRow, OrderStatus } from '@/lib/types';
import { api, errorMessage, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

const LABELS: Record<OrderStatus, string> = {
  new: 'New',
  pending: 'Pending',
  confirmed: 'Confirm',
  processing: 'Start processing',
  packed: 'Mark packed',
  shipped: 'Mark shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
  returned: 'Mark returned',
  refunded: 'Mark refunded',
  failed: 'Mark failed',
};

/**
 * Moving an order along, and recording a dispatch.
 *
 * The buttons come from `allowedTransitions`, which the API derives from
 * `ORDER_TRANSITIONS` — the panel never decides what may follow what. The API
 * re-checks the same map on the way in, so a stale page cannot make a move that
 * is no longer legal; it just gets a clear refusal.
 */
export function OrderWorkflow({ order, canUpdate }: { order: OrderDetailRow; canUpdate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<OrderStatus | null>(null);
  const [error, setError] = React.useState('');
  const [shipOpen, setShipOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const move = async (status: OrderStatus) => {
    // A cancellation puts stock back and cannot be undone from here, so it is
    // the one move that asks first.
    if (status === 'cancelled' && !window.confirm('Cancel this order and return its stock?')) return;

    setBusy(status);
    setError('');

    try {
      await api.patch(`/api/v1/admin/orders/${order.id}/status`, { status });
      toast.success(`Order ${order.orderNumber} is now ${status.replace(/_/g, ' ')}.`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const onShip = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim() || null;

    setSaving(true);
    setError('');

    try {
      await api.post(`/api/v1/admin/orders/${order.id}/shipments`, {
        carrier: text('carrier'),
        trackingNumber: text('trackingNumber'),
        trackingUrl: text('trackingUrl'),
        note: text('note'),
      });
      setShipOpen(false);
      toast.success('Tracking details saved.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details?.trackingUrl) {
        setError(caught.details.trackingUrl[0] ?? errorMessage(caught));
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setSaving(false);
    }
  };

  if (!canUpdate) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What happens next</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {order.allowedTransitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This order is finished — there is nothing further to do with it.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {order.allowedTransitions.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={status === 'cancelled' || status === 'failed' ? 'outline' : 'primary'}
                loading={busy === status}
                disabled={busy !== null}
                onClick={() => move(status)}
              >
                {LABELS[status]}
              </Button>
            ))}
          </div>
        )}

        <div className="border-t pt-4">
          <Button variant="secondary" size="sm" onClick={() => setShipOpen(true)}>
            <Truck aria-hidden /> Add tracking
          </Button>
          {order.shipments.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {order.shipments.map((shipment) => (
                <li key={shipment.id}>
                  {shipment.carrier ?? 'Courier'} · {shipment.trackingNumber ?? 'no number'}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={shipOpen} onOpenChange={setShipOpen}>
        <DialogContent>
          <form onSubmit={onShip}>
            <DialogHeader>
              <DialogTitle>Add tracking</DialogTitle>
              <DialogDescription>
                The customer sees this on their order page, so check it before saving.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <Field label="Courier" htmlFor="carrier">
                <Input id="carrier" name="carrier" placeholder="Pathao Courier" maxLength={80} />
              </Field>
              <Field label="Tracking number" htmlFor="trackingNumber">
                <Input id="trackingNumber" name="trackingNumber" maxLength={120} />
              </Field>
              <Field label="Tracking link" htmlFor="trackingUrl" hint="Optional, but useful.">
                <Input id="trackingUrl" name="trackingUrl" type="url" maxLength={2000} />
              </Field>
              <Field label="Note" htmlFor="note">
                <Input id="note" name="note" maxLength={300} />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShipOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save tracking
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
