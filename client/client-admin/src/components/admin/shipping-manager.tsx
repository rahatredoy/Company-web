'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ShippingMethodRow, ShippingZoneRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogColumn,
  DialogColumns,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

type ZoneDraft = ShippingZoneRow | null;
type MethodDraft = { zoneId: string; method: ShippingMethodRow | null } | null;

/**
 * Delivery zones and their rates.
 *
 * The catch-all zone is the one with no countries listed; checkout falls back to
 * it when an address matches nothing else, so a store without one cannot quote
 * and cannot take an order. That is why it cannot be deleted or demoted here —
 * the API refuses both, and this only mirrors the refusal.
 */
export function ShippingManager({
  zones,
  currency,
  canManage,
}: {
  zones: ShippingZoneRow[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [zoneDraft, setZoneDraft] = React.useState<ZoneDraft>(null);
  const [zoneOpen, setZoneOpen] = React.useState(false);
  const [methodDraft, setMethodDraft] = React.useState<MethodDraft>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const reset = () => {
    setError('');
    setFieldErrors({});
  };

  const handle = (caught: unknown) => {
    if (caught instanceof ApiError && caught.details) {
      setFieldErrors(
        Object.fromEntries(Object.entries(caught.details).map(([k, v]) => [k, v[0] ?? ''])),
      );
    }
    setError(errorMessage(caught));
  };

  const saveZone = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const list = (name: string) =>
      String(data.get(name) ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    const payload = {
      name: String(data.get('name') ?? '').trim(),
      countries: list('countries'),
      cities: list('cities'),
      isDefault: data.get('isDefault') === 'on',
      isActive: data.get('isActive') === 'on',
      sortOrder: Number(data.get('sortOrder') ?? 0),
    };

    setSaving(true);
    reset();

    try {
      if (zoneDraft) await api.put(`/api/v1/admin/shipping/zones/${zoneDraft.id}`, payload);
      else await api.post('/api/v1/admin/shipping/zones', payload);

      setZoneOpen(false);
      toast.success('Zone saved.');
      router.refresh();
    } catch (caught) {
      handle(caught);
    } finally {
      setSaving(false);
    }
  };

  const saveMethod = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !methodDraft) return;

    const data = new FormData(event.currentTarget);
    const number = (name: string) => {
      const raw = String(data.get(name) ?? '').trim();
      return raw ? Number(raw) : null;
    };

    const payload = {
      zoneId: methodDraft.zoneId,
      name: String(data.get('name') ?? '').trim(),
      description: String(data.get('description') ?? '').trim() || null,
      price: String(data.get('price') ?? '0').trim(),
      freeAboveSubtotal: String(data.get('freeAboveSubtotal') ?? '').trim() || null,
      estimatedDaysMin: number('estimatedDaysMin'),
      estimatedDaysMax: number('estimatedDaysMax'),
      isActive: data.get('isActive') === 'on',
      sortOrder: Number(data.get('sortOrder') ?? 0),
    };

    setSaving(true);
    reset();

    try {
      if (methodDraft.method) {
        await api.put(`/api/v1/admin/shipping/methods/${methodDraft.method.id}`, payload);
      } else {
        await api.post('/api/v1/admin/shipping/methods', payload);
      }

      setMethodDraft(null);
      toast.success('Delivery option saved.');
      router.refresh();
    } catch (caught) {
      handle(caught);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind: 'zones' | 'methods', id: string, label: string) => {
    if (!window.confirm(`Remove ${label}?`)) return;

    try {
      await api.delete(`/api/v1/admin/shipping/${kind}/${id}`);
      toast.success('Removed.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-6">
      {error && !zoneOpen && !methodDraft ? <Alert variant="danger">{error}</Alert> : null}

      {canManage ? (
        <Button
          size="sm"
          onClick={() => {
            setZoneDraft(null);
            reset();
            setZoneOpen(true);
          }}
        >
          <Plus aria-hidden /> Add zone
        </Button>
      ) : null}

      {zones.map((zone) => (
        <Card key={zone.id}>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                {zone.name}
                {zone.isDefault ? <Badge variant="info">Catch-all</Badge> : null}
                {!zone.isActive ? <Badge variant="neutral">Off</Badge> : null}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {zone.countries.length === 0 && zone.cities.length === 0
                  ? 'Everywhere not covered by another zone.'
                  : [...zone.cities, ...zone.countries].join(', ')}
              </p>
            </div>
            {canManage ? (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setZoneDraft(zone);
                    reset();
                    setZoneOpen(true);
                  }}
                >
                  <Pencil aria-hidden /> Edit
                </Button>
                {!zone.isDefault ? (
                  <Button variant="ghost" size="sm" onClick={() => remove('zones', zone.id, zone.name)}>
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {zone.methods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No delivery option here yet, so this zone cannot be quoted.
              </p>
            ) : (
              <ul className="divide-y">
                {zone.methods.map((method) => (
                  <li key={method.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {method.name}
                        {!method.isActive ? (
                          <Badge variant="neutral" className="ml-2">
                            Off
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatMoney(method.price, currency)}
                        {method.freeAboveSubtotal
                          ? ` · free over ${formatMoney(method.freeAboveSubtotal, currency)}`
                          : ''}
                        {method.estimatedDaysMin !== null
                          ? ` · ${method.estimatedDaysMin}–${method.estimatedDaysMax ?? method.estimatedDaysMin} days`
                          : ''}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setMethodDraft({ zoneId: zone.id, method });
                            reset();
                          }}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove('methods', method.id, method.name)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canManage ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setMethodDraft({ zoneId: zone.id, method: null });
                  reset();
                }}
              >
                <Plus aria-hidden /> Add delivery option
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}

      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent size="md">
          <form onSubmit={saveZone}>
            <DialogHeader>
              <DialogTitle>{zoneDraft ? 'Edit zone' : 'Add a zone'}</DialogTitle>
              <DialogDescription>
                Leave both lists empty to make this the catch-all for everywhere else.
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* Where the zone covers on the left, what the store does with it
                  on the right. */}
              <DialogColumns>
                <DialogColumn>
                  <Field label="Name" htmlFor="zone-name" required error={fieldErrors.name}>
                    <Input id="zone-name" name="name" defaultValue={zoneDraft?.name ?? ''} maxLength={120} />
                  </Field>
                  <Field label="Countries" htmlFor="zone-countries" hint="Comma separated.">
                    <Input
                      id="zone-countries"
                      name="countries"
                      defaultValue={zoneDraft?.countries.join(', ') ?? ''}
                      placeholder="Bangladesh, India"
                    />
                  </Field>
                  <Field label="Cities" htmlFor="zone-cities" hint="Comma separated. Beats a country match.">
                    <Input id="zone-cities" name="cities" defaultValue={zoneDraft?.cities.join(', ') ?? ''} />
                  </Field>
                </DialogColumn>

                <DialogColumn>
                  <Field label="Order" htmlFor="zone-sort">
                    <Input id="zone-sort" name="sortOrder" type="number" defaultValue={zoneDraft?.sortOrder ?? 0} />
                  </Field>

                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isDefault" defaultChecked={zoneDraft?.isDefault ?? zones.length === 0} />
                    Use as the catch-all zone
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isActive" defaultChecked={zoneDraft?.isActive ?? true} />
                    Quote this zone at checkout
                  </label>
                </DialogColumn>
              </DialogColumns>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setZoneOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save zone
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={methodDraft !== null} onOpenChange={(open) => !open && setMethodDraft(null)}>
        <DialogContent size="md">
          <form onSubmit={saveMethod}>
            <DialogHeader>
              <DialogTitle>{methodDraft?.method ? 'Edit delivery option' : 'Add a delivery option'}</DialogTitle>
              <DialogDescription>This is what the customer picks and is charged.</DialogDescription>
            </DialogHeader>

            <DialogBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* What the customer is offered and charged on the left; how long
                  it takes and where it sits in the list on the right. */}
              <DialogColumns>
                <DialogColumn>
                  <Field label="Name" htmlFor="m-name" required error={fieldErrors.name}>
                    <Input id="m-name" name="name" defaultValue={methodDraft?.method?.name ?? ''} maxLength={80} />
                  </Field>
                  <Field label="Description" htmlFor="m-desc">
                    <Input id="m-desc" name="description" defaultValue={methodDraft?.method?.description ?? ''} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Price" htmlFor="m-price" required error={fieldErrors.price}>
                      <Input id="m-price" name="price" defaultValue={methodDraft?.method?.price ?? '0.00'} />
                    </Field>
                    <Field label="Free above" htmlFor="m-free" hint="Optional order subtotal.">
                      <Input
                        id="m-free"
                        name="freeAboveSubtotal"
                        defaultValue={methodDraft?.method?.freeAboveSubtotal ?? ''}
                      />
                    </Field>
                  </div>
                </DialogColumn>

                <DialogColumn>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Fastest (days)" htmlFor="m-min">
                      <Input
                        id="m-min"
                        name="estimatedDaysMin"
                        type="number"
                        min={0}
                        defaultValue={methodDraft?.method?.estimatedDaysMin ?? ''}
                      />
                    </Field>
                    <Field label="Slowest (days)" htmlFor="m-max">
                      <Input
                        id="m-max"
                        name="estimatedDaysMax"
                        type="number"
                        min={0}
                        defaultValue={methodDraft?.method?.estimatedDaysMax ?? ''}
                      />
                    </Field>
                  </div>
                  <Field label="Order" htmlFor="m-sort">
                    <Input id="m-sort" name="sortOrder" type="number" defaultValue={methodDraft?.method?.sortOrder ?? 0} />
                  </Field>
                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isActive" defaultChecked={methodDraft?.method?.isActive ?? true} />
                    Offer this at checkout
                  </label>
                </DialogColumn>
              </DialogColumns>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMethodDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save option
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
