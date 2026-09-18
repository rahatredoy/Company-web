'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerView } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { useT } from '@/lib/i18n';

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
 *
 * Drawn inside the customer's View panel — a customer has no screen of its own —
 * so a change re-reads the panel (`onChanged`) as well as the list behind it.
 */
export function CustomerActions({
  customer,
  canUpdate,
  onChanged,
}: {
  customer: Pick<CustomerView, 'id' | 'fullName' | 'status' | 'acceptsMarketing' | 'adminNote'>;
  canUpdate: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const t = useT();
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
      onChanged?.();
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
        t('Block {name}? They will be signed out everywhere and cannot sign in again until you unblock them.', {
          name: customer.fullName,
        }),
      )
    ) {
      return;
    }

    void patch(
      { status: blocked ? 'active' : 'blocked' },
      blocked ? t('Customer unblocked.') : t('Customer blocked and signed out.'),
    );
  };

  const onToggleMarketing = (next: boolean) => {
    void patch(
      { acceptsMarketing: next },
      next ? t('Marketing emails allowed.') : t('Marketing emails stopped.'),
    );
  };

  const onSaveNote = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('adminNote') ?? '').trim();
    void patch({ adminNote: note || null }, t('Note saved.'));
  };

  return (
    <div className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="acceptsMarketing">{t('Marketing emails')}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {customer.acceptsMarketing
                ? t('They have agreed to receive campaigns.')
                : t('They will not be sent campaigns.')}
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
            label={t('Internal note')}
            htmlFor="adminNote"
            hint={t('Only staff see this. It never reaches the customer.')}
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
            {t('Save note')}
          </Button>
        </form>

        <div className="border-t pt-4">
          <Button
            variant={blocked ? 'secondary' : 'destructive'}
            size="sm"
            onClick={onToggleBlock}
            disabled={saving}
          >
            {blocked ? t('Unblock customer') : t('Block customer')}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {blocked
              ? t('They cannot sign in. Their past orders are untouched.')
              : t('Blocking signs them out of every device immediately.')}
          </p>
        </div>
    </div>
  );
}
