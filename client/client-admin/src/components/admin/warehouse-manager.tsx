'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, MoreVertical, Phone, Plus, Star, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetColumn,
  SheetColumns,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import type { WarehouseRow } from '@/lib/types';

/**
 * Where stock is counted.
 *
 * Every stock level belongs to one of these, so a store needs at least one before
 * anything can be counted — provisioning seeds a default so that is never the
 * owner's first problem. The **first** warehouse created is the default whatever
 * the switch says, because a store with stock and no default has nowhere to put an
 * adjustment.
 *
 * Editing and deleting are both offered, and both are fenced by the API rather
 * than by hiding a button: `inventory_levels` cascades from a warehouse, so a
 * delete would take its counts with it silently, and the API refuses while
 * anything is still on those shelves, for the default, and for the last one
 * standing. Retiring a warehouse means moving its stock out and deactivating it.
 */

interface Draft {
  name: string;
  code: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  isDefault: boolean;
  isActive: boolean;
}

function draftFrom(row: WarehouseRow | null, isFirst: boolean): Draft {
  return {
    name: row?.name ?? '',
    code: row?.code ?? '',
    address: row?.address ?? '',
    city: row?.city ?? '',
    country: row?.country ?? '',
    phone: row?.phone ?? '',
    isDefault: row?.isDefault ?? isFirst,
    isActive: row?.isActive ?? true,
  };
}

export function WarehouseManager({
  rows,
  canManage,
  /** Units held per warehouse id, so a delete can be explained before it is refused. */
  unitsByWarehouse = {},
}: {
  rows: WarehouseRow[];
  canManage: boolean;
  unitsByWarehouse?: Record<string, number>;
}) {
  const router = useRouter();
  const [panel, setPanel] = React.useState<{ open: boolean; row: WarehouseRow | null }>({
    open: false,
    row: null,
  });
  const [busy, setBusy] = React.useState(false);

  const refresh = () => router.refresh();

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      toast.success(label);
      refresh();
    } catch (caught) {
      // The API's own sentence names the reason — stock still held, the default,
      // the last one — and that is what the owner needs to read.
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: WarehouseRow) {
    const held = unitsByWarehouse[row.id] ?? 0;
    const warning = held
      ? `\n\nIt still holds ${formatNumber(held)} unit(s), so this will be refused until they are moved or written off.`
      : '';
    if (!globalThis.confirm(`Delete “${row.name}”?${warning}`)) return;
    await run('Warehouse deleted.', () => api.delete(`/api/v1/admin/warehouses/${row.id}`));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? 'Stock cannot be counted until there is one.'
            : `${formatNumber(rows.length)} warehouse${rows.length === 1 ? '' : 's'} · one is always the default`}
        </p>
        {canManage ? (
          <Button onClick={() => setPanel({ open: true, row: null })}>
            <Plus /> Add Warehouse
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <WarehouseIcon className="size-6" aria-hidden />
            No warehouses yet. Stock cannot be counted until there is one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const held = unitsByWarehouse[row.id] ?? 0;

            return (
              <Card key={row.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-accent-foreground"
                        aria-hidden
                      >
                        <WarehouseIcon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{row.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
                      </div>
                    </div>

                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={busy}
                            aria-label={`Actions for ${row.name}`}
                          >
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setPanel({ open: true, row })}>
                            Edit warehouse
                          </DropdownMenuItem>
                          {row.isDefault ? null : (
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(`${row.name} is now the default.`, () =>
                                  api.patch(`/api/v1/admin/warehouses/${row.id}`, { isDefault: true }),
                                )
                              }
                            >
                              <Star /> Make default
                            </DropdownMenuItem>
                          )}
                          {row.isDefault ? null : (
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(row.isActive ? 'Deactivated.' : 'Activated.', () =>
                                  api.patch(`/api/v1/admin/warehouses/${row.id}`, { isActive: !row.isActive }),
                                )
                              }
                            >
                              {row.isActive ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => void remove(row)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.isDefault ? <Badge variant="info">Default</Badge> : null}
                    <Badge variant={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {held > 0 ? <Badge variant="neutral">{formatNumber(held)} units</Badge> : null}
                  </div>

                  {row.address || row.city || row.country ? (
                    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>{[row.address, row.city, row.country].filter(Boolean).join(', ')}</span>
                    </p>
                  ) : null}

                  {row.phone ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Phone className="size-3.5 shrink-0" aria-hidden />
                      {row.phone}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <WarehousePanel
        open={panel.open}
        onOpenChange={(open) => setPanel((current) => ({ ...current, open }))}
        warehouse={panel.row}
        isFirst={rows.length === 0}
        onSaved={refresh}
      />
    </div>
  );
}

function WarehousePanel({
  open,
  onOpenChange,
  warehouse,
  isFirst,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: WarehouseRow | null;
  isFirst: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(warehouse, isFirst));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const identity = `${open ? 'open' : 'shut'}:${warehouse?.id ?? 'new'}`;
  const [lastIdentity, setLastIdentity] = React.useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setDraft(draftFrom(warehouse, isFirst));
    setError('');
    setFieldErrors({});
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});

    const payload = {
      name: draft.name.trim(),
      code: draft.code.trim(),
      address: draft.address.trim() || null,
      city: draft.city.trim() || null,
      country: draft.country.trim() || null,
      phone: draft.phone.trim() || null,
      isDefault: draft.isDefault,
      isActive: draft.isActive,
    };

    try {
      if (warehouse) await api.patch(`/api/v1/admin/warehouses/${warehouse.id}`, payload);
      else await api.post('/api/v1/admin/warehouses', payload);

      toast.success(warehouse ? 'Warehouse saved.' : 'Warehouse added.');
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{warehouse ? 'Edit Warehouse' : 'Add Warehouse'}</SheetTitle>
            <SheetDescription>
              Somewhere stock is held — a shop floor, a storeroom, a supplier who ships for you.
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            {/* Where the place is on the left, what the store does with it on
                the right. */}
            <SheetColumns>
              <SheetColumn>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" htmlFor="wh-name" required error={fieldErrors.name}>
                    <Input
                      id="wh-name"
                      value={draft.name}
                      onChange={(event) => set('name', event.target.value)}
                      required
                      maxLength={140}
                      placeholder="Main storeroom"
                      autoFocus
                    />
                  </Field>

                  <Field
                    label="Code"
                    htmlFor="wh-code"
                    required
                    hint="Short and unique. Stored in capitals."
                    error={fieldErrors.code}
                  >
                    <Input
                      id="wh-code"
                      value={draft.code}
                      onChange={(event) => set('code', event.target.value)}
                      required
                      maxLength={24}
                      placeholder="MAIN"
                      className="font-mono text-xs uppercase"
                    />
                  </Field>
                </div>

                <Field label="Address" htmlFor="wh-address" error={fieldErrors.address}>
                  <Textarea
                    id="wh-address"
                    value={draft.address}
                    onChange={(event) => set('address', event.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="City" htmlFor="wh-city" error={fieldErrors.city}>
                    <Input
                      id="wh-city"
                      value={draft.city}
                      onChange={(event) => set('city', event.target.value)}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Country" htmlFor="wh-country" error={fieldErrors.country}>
                    <Input
                      id="wh-country"
                      value={draft.country}
                      onChange={(event) => set('country', event.target.value)}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Phone" htmlFor="wh-phone" error={fieldErrors.phone}>
                    <Input
                      id="wh-phone"
                      value={draft.phone}
                      onChange={(event) => set('phone', event.target.value)}
                      maxLength={24}
                    />
                  </Field>
                </div>
              </SheetColumn>

              <SheetColumn>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="wh-default">Default warehouse</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Where stock lands when nothing else is chosen. Exactly one store-wide.
                    </p>
                  </div>
                  <Switch
                    id="wh-default"
                    checked={draft.isDefault}
                    disabled={warehouse?.isDefault}
                    onCheckedChange={(checked) => set('isDefault', checked)}
                  />
                </div>

                {warehouse?.isDefault ? (
                  <p className="-mt-3 text-xs text-muted-foreground">
                    This is the default. Make another one the default to move the flag.
                  </p>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="wh-active">Available for stock</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Deactivate a warehouse you have emptied.</p>
                  </div>
                  <Switch
                    id="wh-active"
                    checked={draft.isActive}
                    disabled={warehouse?.isDefault}
                    onCheckedChange={(checked) => set('isActive', checked)}
                  />
                </div>

                {fieldErrors.isDefault ? <p className="text-xs text-destructive">{fieldErrors.isDefault}</p> : null}
                {fieldErrors.isActive ? <p className="text-xs text-destructive">{fieldErrors.isActive}</p> : null}
              </SheetColumn>
            </SheetColumns>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {warehouse ? 'Save Warehouse' : 'Add Warehouse'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
