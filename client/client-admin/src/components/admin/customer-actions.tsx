'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerDetail } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

/**
 * The three things staff can do to a customer record.
 *
 * There is no delete. Orders point at these rows, and a shop that can erase a
 * customer can erase its own history; blocking stops a sign-in without touching
 * anything that was already bought.
 *
 * Marketing consent is here because it arrives by every channel except this
 * panel — a reply to an email, a phone call, a word at the till — and the API
 * has always accepted it. Without the switch the only way to honour "stop
 * emailing me" was to block the account, which also stops them shopping.
 */
export function CustomerActions({
  customer,
  canUpdate,
}: {
  customer: CustomerDetail;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  if (!canUpdate) return null;

  const blocked = customer.status === 'blocked';

  const patch = async (body: Record<string, unknown>, message: string) => {
    setSaving(true);
    setError('');

    try {
      await api.patch(`/api/v1/admin/customers/${customer.id}`, body);
      toast.success(message);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const onToggleBlock = () => {
    if (
      !blocked &&
      !window.confirm(
        `Block ${customer.fullName}? They will be signed out everywhere and cannot sign in again until you unblock them.`,
      )
    ) {
      return;
    }

    void patch(
      { status: blocked ? 'active' : 'blocked' },
      blocked ? 'Customer unblocked.' : 'Customer blocked and signed out.',
    );
  };

  const onToggleMarketing = (next: boolean) => {
    void patch(
      { acceptsMarketing: next },
      next ? 'Marketing emails allowed.' : 'Marketing emails stopped.',
    );
  };

  const onSaveNote = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('adminNote') ?? '').trim();
    void patch({ adminNote: note || null }, 'Note saved.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="acceptsMarketing">Marketing emails</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {customer.acceptsMarketing
                ? 'They have agreed to receive campaigns.'
                : 'They will not be sent campaigns.'}
            </p>
          </div>
          <Switch
            id="acceptsMarketing"
            checked={customer.acceptsMarketing}
            disabled={saving}
            onCheckedChange={onToggleMarketing}
          />
        </div>

        <form onSubmit={onSaveNote} className="space-y-3 border-t pt-4">
          <Field
            label="Internal note"
            htmlFor="adminNote"
            hint="Only staff see this. It never reaches the customer."
          >
            <Textarea
              id="adminNote"
              name="adminNote"
              rows={4}
              maxLength={4000}
              defaultValue={customer.adminNote ?? ''}
            />
          </Field>
          <Button type="submit" size="sm" variant="secondary" loading={saving}>
            Save note
          </Button>
        </form>

        <div className="border-t pt-4">
          <Button
            variant={blocked ? 'secondary' : 'destructive'}
            size="sm"
            onClick={onToggleBlock}
            disabled={saving}
          >
            {blocked ? 'Unblock customer' : 'Block customer'}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {blocked
              ? 'They cannot sign in. Their past orders are untouched.'
              : 'Blocking signs them out of every device immediately.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
