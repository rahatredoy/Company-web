'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Address } from '@/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AddressBlock } from '@/components/account/order-detail-parts';
import { useT, type MessageKey } from '@/lib/i18n';

/** Sent to the API as written; only the option's label is translated. */
const COUNTRIES: MessageKey[] = ['Bangladesh', 'India', 'Pakistan', 'Sri Lanka', 'Nepal'];

/**
 * The saved address book.
 *
 * The server owns the list — this component never holds it in state, it calls
 * the API and refreshes. Keeping a second copy in the browser is how a deleted
 * address reappears on the next render.
 */
export function AddressBook({ addresses }: { addresses: Address[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Address | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const openFor = (address: Address | null) => {
    setEditing(address);
    setError(null);
    setFieldErrors({});
    setOpen(true);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    const optional = (name: string) => value(name) || null;

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      label: optional('label'),
      fullName: value('fullName'),
      phone: value('phone'),
      addressLine1: value('addressLine1'),
      addressLine2: optional('addressLine2'),
      city: value('city'),
      state: optional('state'),
      postalCode: optional('postalCode'),
      country: value('country'),
      isDefault: data.get('isDefault') === 'on',
    };

    const url = editing ? `/api/account/addresses?id=${encodeURIComponent(editing.id)}` : '/api/account/addresses';

    try {
      const response = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string; details?: Record<string, string> }
        | null;

      if (!response.ok) {
        setError(body?.error ?? t('We could not save that address.'));
        if (body?.details) setFieldErrors(body.details);
        setSaving(false);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError(t('We could not reach the store. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (address: Address) => {
    const question = address.label ? t('Remove {name}?', { name: address.label }) : t('Remove this address?');
    if (!window.confirm(question)) return;

    const response = await fetch(`/api/account/addresses?id=${encodeURIComponent(address.id)}`, {
      method: 'DELETE',
    });

    if (response.ok) router.refresh();
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">
          {addresses.length === 0
            ? t('Nothing saved yet.')
            : t.plural(addresses.length, '{count} saved address.', '{count} saved addresses.')}
        </p>
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> {t('Add address')}
        </Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t('No saved addresses')}
          description={t('Add one here, or the address you enter at checkout will be saved for you.')}
          className="mt-4 rounded-(--radius-card) border border-dashed border-border"
        />
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-(--radius-card) border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">{address.label ?? t('Address')}</p>
                {address.isDefault ? <Badge tone="soft">{t('Default')}</Badge> : null}
              </div>
              <AddressBlock address={address} className="mt-3" />
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openFor(address)}>
                  <Pencil aria-hidden /> {t('Edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(address)}
                  aria-label={address.label ? t('Remove {name}', { name: address.label }) : t('Remove address')}
                >
                  <Trash2 aria-hidden /> {t('Remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? t('Edit address') : t('Add an address')}</DialogTitle>
              <DialogDescription>{t('Where we should send your orders.')}</DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
              {error ? <Alert tone="danger">{error}</Alert> : null}

              <Field name="label" label={t('Name this address')} hint={t('Home, Office — anything you like.')}>
                {(props) => <Input {...props} defaultValue={editing?.label ?? ''} maxLength={40} />}
              </Field>

              <Field name="fullName" label={t('Full name')} required error={fieldErrors.fullName}>
                {(props) => (
                  <Input {...props} defaultValue={editing?.fullName ?? ''} autoComplete="name" />
                )}
              </Field>

              <Field name="phone" label={t('Phone')} required error={fieldErrors.phone}>
                {(props) => <Input {...props} defaultValue={editing?.phone ?? ''} autoComplete="tel" />}
              </Field>

              <Field name="addressLine1" label={t('Address')} required error={fieldErrors.addressLine1}>
                {(props) => (
                  <Input
                    {...props}
                    defaultValue={editing?.addressLine1 ?? ''}
                    placeholder={t('House, road, area')}
                    autoComplete="address-line1"
                  />
                )}
              </Field>

              <Field name="addressLine2" label={t('Apartment, floor, landmark')}>
                {(props) => (
                  <Input
                    {...props}
                    defaultValue={editing?.addressLine2 ?? ''}
                    autoComplete="address-line2"
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="city" label={t('City')} required error={fieldErrors.city}>
                  {(props) => (
                    <Input {...props} defaultValue={editing?.city ?? ''} autoComplete="address-level2" />
                  )}
                </Field>
                <Field name="state" label={t('District / State')}>
                  {(props) => (
                    <Input {...props} defaultValue={editing?.state ?? ''} autoComplete="address-level1" />
                  )}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="postalCode" label={t('Postcode')}>
                  {(props) => (
                    <Input
                      {...props}
                      defaultValue={editing?.postalCode ?? ''}
                      inputMode="numeric"
                      autoComplete="postal-code"
                    />
                  )}
                </Field>
                <Field name="country" label={t('Country')} required error={fieldErrors.country}>
                  {(props) => (
                    <select
                      {...props}
                      defaultValue={editing?.country ?? COUNTRIES[0]}
                      autoComplete="country-name"
                      className="h-11 w-full rounded-(--radius-input) border border-border bg-surface px-3 text-sm"
                    >
                      {COUNTRIES.map((country) => (
                        <option key={country} value={country}>
                          {t(country)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>

              <CheckboxField
                id="isDefault"
                name="isDefault"
                label={t('Use this as my default address')}
                defaultChecked={editing?.isDefault ?? addresses.length === 0}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('Saving…') : editing ? t('Save changes') : t('Add address')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
