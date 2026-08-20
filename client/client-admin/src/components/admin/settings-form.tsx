'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { PaymentMethodRow, StoreSettingsRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { DEFAULT_MEASURE_OPTIONS, MAX_MEASURE_OPTIONS, type MeasureOption } from '@/lib/measure';

/**
 * Store settings.
 *
 * Currency is the field with teeth. Prices are stored as plain decimals with no
 * currency of their own, so changing the code re-labels every existing price and
 * every past order's total rather than converting them — which is why the API
 * refuses once the shop has taken an order, and why the input says so instead of
 * failing after the fact.
 */
export function SettingsForm({
  settings,
  paymentMethods,
  canUpdate,
}: {
  settings: StoreSettingsRow;
  paymentMethods: PaymentMethodRow[];
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const currencyLocked = settings.orderCount > 0;

  /*
   * The shop's default size picker, held in state rather than read off the form:
   * it is a list with rows that are added and removed, and numbered field names
   * would leave a hole in the sequence on every removal.
   */
  const [measureOptions, setMeasureOptions] = React.useState<MeasureOption[]>(
    settings.measureOptions.length > 0
      ? settings.measureOptions
      : (settings.defaultMeasureOptions ?? DEFAULT_MEASURE_OPTIONS),
  );

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const optional = (name: string) => text(name) || null;

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      await api.put('/api/v1/admin/settings', {
        storeName: text('storeName'),
        // A disabled input contributes nothing to FormData, so the current value
        // is sent back explicitly rather than arriving as an empty string.
        currency: currencyLocked ? settings.currency : text('currency'),
        language: text('language'),
        timezone: text('timezone'),
        businessName: optional('businessName'),
        businessEmail: optional('businessEmail'),
        businessPhone: optional('businessPhone'),
        businessAddress: optional('businessAddress'),
        seoTitle: optional('seoTitle'),
        seoDescription: optional('seoDescription'),
        whatsappNumber: optional('whatsappNumber'),
        whatsappEnabled: data.get('whatsappEnabled') === 'on',
        lowStockThreshold: Number(data.get('lowStockThreshold') ?? 5),
        // Half-typed rows are dropped rather than refused: the owner is mid-
        // thought, and a validation error on a row they are still filling in
        // would block a save that has nothing to do with it.
        measureOptions: measureOptions.filter((option) => option.measure > 0 && option.label.trim() !== ''),
      });

      toast.success('Settings saved.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const togglePayment = async (method: PaymentMethodRow) => {
    try {
      await api.put('/api/v1/admin/settings/payment-methods', {
        provider: method.provider,
        label: method.label,
        description: method.description,
        instructions: method.instructions,
        isEnabled: !method.isEnabled,
        sortOrder: method.sortOrder,
      });

      toast.success(method.isEnabled ? `${method.label} switched off.` : `${method.label} switched on.`);
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Your store</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Store name" htmlFor="storeName" required error={fieldErrors.storeName}>
            <Input id="storeName" name="storeName" defaultValue={settings.storeName} disabled={!canUpdate} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Currency"
              htmlFor="currency"
              error={fieldErrors.currency}
              hint={
                currencyLocked
                  ? 'Locked — your prices and past orders are all recorded in this currency.'
                  : 'Three-letter code, e.g. BDT.'
              }
            >
              <Input
                id="currency"
                name="currency"
                maxLength={3}
                defaultValue={settings.currency}
                disabled={!canUpdate || currencyLocked}
                className="uppercase"
              />
            </Field>
            <Field label="Language" htmlFor="language">
              <Input id="language" name="language" maxLength={8} defaultValue={settings.language} disabled={!canUpdate} />
            </Field>
            <Field label="Timezone" htmlFor="timezone">
              <Input id="timezone" name="timezone" defaultValue={settings.timezone} disabled={!canUpdate} />
            </Field>
          </div>

          <Field label="Low-stock warning at" htmlFor="lowStockThreshold" hint="Used for new stock records.">
            <Input
              id="lowStockThreshold"
              name="lowStockThreshold"
              type="number"
              min={0}
              defaultValue={settings.lowStockThreshold}
              disabled={!canUpdate}
            />
          </Field>

          {/*
            Set once for the whole shop, because a greengrocer sells most of its
            catalogue the same four ways. A product may still name its own list
            on its Details tab; this is what every other one uses.
          */}
          <div className="space-y-2 border-t border-border/60 pt-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Default sizes for products sold by weight</p>
              <p className="text-xs text-muted-foreground">
                The picker a shopper sees on the card — 1kg, 500gm, 250gm. The amount is in the
                product&apos;s own base unit: grams for weight, millilitres for volume.
              </p>
            </div>

            <div className="space-y-1.5">
              {measureOptions.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option.label}
                    onChange={(event) =>
                      setMeasureOptions((rows) =>
                        rows.map((row, i) => (i === index ? { ...row, label: event.target.value } : row)),
                      )
                    }
                    placeholder="500gm"
                    maxLength={24}
                    disabled={!canUpdate}
                    aria-label={'Size ' + (index + 1) + ' label'}
                    className="flex-1"
                  />
                  <Input
                    value={option.measure > 0 ? String(option.measure) : ''}
                    onChange={(event) =>
                      setMeasureOptions((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? { ...row, measure: Number(event.target.value.replace(/[^0-9]/g, '')) || 0 }
                            : row,
                        ),
                      )
                    }
                    placeholder="500"
                    inputMode="numeric"
                    disabled={!canUpdate}
                    aria-label={'Size ' + (index + 1) + ' amount'}
                    className="w-28"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground"
                    disabled={!canUpdate}
                    onClick={() => setMeasureOptions((rows) => rows.filter((_, i) => i !== index))}
                    aria-label={'Remove size ' + (index + 1)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>

            {canUpdate && measureOptions.length < MAX_MEASURE_OPTIONS ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMeasureOptions((rows) => [...rows, { label: '', measure: 0 }])}
              >
                <Plus className="mr-1 size-4" aria-hidden /> Add a size
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Shown on your storefront and printed on invoices.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="businessName">
              <Input id="businessName" name="businessName" defaultValue={settings.businessName ?? ''} disabled={!canUpdate} />
            </Field>
            <Field label="Email" htmlFor="businessEmail">
              <Input id="businessEmail" name="businessEmail" type="email" defaultValue={settings.businessEmail ?? ''} disabled={!canUpdate} />
            </Field>
          </div>

          <Field label="Phone" htmlFor="businessPhone">
            <Input id="businessPhone" name="businessPhone" defaultValue={settings.businessPhone ?? ''} disabled={!canUpdate} />
          </Field>

          <Field label="Address" htmlFor="businessAddress">
            <Textarea id="businessAddress" name="businessAddress" rows={3} defaultValue={settings.businessAddress ?? ''} disabled={!canUpdate} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="WhatsApp number" htmlFor="whatsappNumber">
              <Input id="whatsappNumber" name="whatsappNumber" defaultValue={settings.whatsappNumber ?? ''} disabled={!canUpdate} />
            </Field>
            <label className="flex items-center gap-3 self-end pb-2 text-sm">
              <Switch name="whatsappEnabled" defaultChecked={settings.whatsappEnabled} disabled={!canUpdate} />
              Show the WhatsApp button
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search engines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Title" htmlFor="seoTitle">
            <Input id="seoTitle" name="seoTitle" maxLength={160} defaultValue={settings.seoTitle ?? ''} disabled={!canUpdate} />
          </Field>
          <Field label="Description" htmlFor="seoDescription">
            <Textarea id="seoDescription" name="seoDescription" rows={2} maxLength={300} defaultValue={settings.seoDescription ?? ''} disabled={!canUpdate} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Only what is switched on here is offered at checkout.
          </p>

          {paymentMethods.length === 0 ? (
            <Alert variant="warning">
              Nothing is switched on, so nobody can check out. Cash on delivery needs no account.
            </Alert>
          ) : (
            <ul className="divide-y">
              {paymentMethods.map((method) => (
                <li key={method.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{method.label}</p>
                    {method.description ? (
                      <p className="text-xs text-muted-foreground">{method.description}</p>
                    ) : null}
                  </div>
                  <Switch
                    checked={method.isEnabled}
                    disabled={!canUpdate}
                    onCheckedChange={() => togglePayment(method)}
                    aria-label={`${method.isEnabled ? 'Disable' : 'Enable'} ${method.label}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canUpdate ? (
        <Button type="submit" loading={saving}>
          Save settings
        </Button>
      ) : null}
    </form>
  );
}
