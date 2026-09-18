'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CardPrefix, CardType, PaymentBank } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { CARD_TYPE_LABELS } from '@/lib/discounts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
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
import { Skeleton } from '@/components/ui/skeleton';

const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

interface BankDraft {
  id: string | null;
  name: string;
  shortName: string;
  country: string;
  isActive: boolean;
  sortOrder: number;
  cardPrefixes: CardPrefix[];
}

const blank = (sortOrder: number): BankDraft => ({
  id: null,
  name: '',
  shortName: '',
  country: 'BD',
  isActive: true,
  sortOrder,
  cardPrefixes: [{ prefix: '', cardType: 'credit', label: null }],
});

/**
 * The banks a card offer can name, and the card prefixes that prove a card is
 * theirs.
 *
 * The prefixes are the part that matters and the part nobody else can fill in:
 * "Islami Bank card" is not something a shop can see at the till, the first six
 * to eight digits of the card are. A bank with none listed cannot back an offer,
 * and the API refuses to save one that names it — so this is where an owner is
 * sent when that happens.
 */
export function BankManager({
  open,
  onOpenChange,
  onChanged,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: (banks: PaymentBank[]) => void;
  canManage: boolean;
}) {
  const [banks, setBanks] = React.useState<PaymentBank[] | null>(null);
  const [editing, setEditing] = React.useState<BankDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    try {
      const rows = await api.get<PaymentBank[]>('/api/v1/admin/discounts/banks');
      setBanks(rows);
      onChanged?.(rows);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [onChanged]);

  // The caller remounts this per opening (a fresh `key`), so only the read is left to do.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<PaymentBank[]>('/api/v1/admin/discounts/banks')
      .then((rows) => {
        if (cancelled) return;
        setBanks(rows);
        onChanged?.(rows);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
    // `onChanged` is the caller's; the opening is what triggers the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    setFieldErrors({});

    const body = {
      name: editing.name.trim(),
      shortName: editing.shortName.trim() || null,
      country: editing.country.trim() || 'BD',
      isActive: editing.isActive,
      sortOrder: editing.sortOrder,
      cardPrefixes: editing.cardPrefixes
        .filter((entry) => entry.prefix.trim() !== '')
        .map((entry) => ({ ...entry, prefix: entry.prefix.trim(), label: entry.label?.trim() || null })),
    };

    try {
      if (editing.id) await api.put(`/api/v1/admin/discounts/banks/${editing.id}`, body);
      else await api.post('/api/v1/admin/discounts/banks', body);
      toast.success(editing.id ? 'Bank saved.' : 'Bank added.');
      setEditing(null);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])));
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (bank: PaymentBank) => {
    if (!window.confirm(`Remove ${bank.name} from the list?`)) return;
    try {
      await api.delete(`/api/v1/admin/discounts/banks/${bank.id}`);
      toast.success('Bank removed.');
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const setPrefix = (index: number, patch: Partial<CardPrefix>) =>
    setEditing((current) =>
      current
        ? { ...current, cardPrefixes: current.cardPrefixes.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) }
        : current,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? (editing.id ? `Edit ${editing.name}` : 'Add a bank') : 'Banks & card prefixes'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'List the first 6 to 8 digits of each card range this bank issues. A card is matched to the bank by these digits, and nothing else.'
              : 'The banks a card offer can name. A bank needs its card prefixes before an offer can use it.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error ? <Alert variant="danger">{error}</Alert> : null}

          {editing ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_10rem_6rem]">
                <Field label="Bank name" htmlFor="bank-name" required error={fieldErrors.name}>
                  <Input
                    id="bank-name"
                    value={editing.name}
                    maxLength={120}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </Field>
                <Field label="Short name" htmlFor="bank-short">
                  <Input
                    id="bank-short"
                    value={editing.shortName}
                    maxLength={40}
                    onChange={(event) => setEditing({ ...editing, shortName: event.target.value })}
                  />
                </Field>
                <Field label="Country" htmlFor="bank-country" error={fieldErrors.country}>
                  <Input
                    id="bank-country"
                    value={editing.country}
                    maxLength={2}
                    className="uppercase"
                    onChange={(event) => setEditing({ ...editing, country: event.target.value.toUpperCase() })}
                  />
                </Field>
              </div>

              <label className="flex items-center gap-3 text-sm">
                <Switch checked={editing.isActive} onCheckedChange={(checked) => setEditing({ ...editing, isActive: checked })} />
                Offers may name this bank
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Card prefixes</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({ ...editing, cardPrefixes: [...editing.cardPrefixes, { prefix: '', cardType: 'credit', label: null }] })
                    }
                  >
                    <Plus aria-hidden /> Add prefix
                  </Button>
                </div>
                {fieldErrors.cardPrefixes ? <p className="text-xs text-destructive">{fieldErrors.cardPrefixes}</p> : null}
                <div className="space-y-2">
                  {editing.cardPrefixes.map((entry, index) => {
                    const prefixError = fieldErrors[`cardPrefixes.${index}.prefix`];
                    return (
                      <div key={index} className="grid grid-cols-[8rem_7rem_1fr_auto] items-start gap-2">
                        <div>
                          <Input
                            aria-label="Card prefix"
                            inputMode="numeric"
                            placeholder="421234"
                            value={entry.prefix}
                            maxLength={8}
                            invalid={Boolean(prefixError)}
                            onChange={(event) => setPrefix(index, { prefix: event.target.value.replace(/\D/g, '') })}
                            className="h-9 font-mono"
                          />
                          {prefixError ? <p className="mt-1 text-[11px] text-destructive">{prefixError}</p> : null}
                        </div>
                        <select
                          aria-label="Card type"
                          value={entry.cardType ?? ''}
                          onChange={(event) => setPrefix(index, { cardType: (event.target.value || null) as CardType | null })}
                          className={SELECT_CLASS}
                        >
                          <option value="">Any type</option>
                          {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((type) => (
                            <option key={type} value={type}>
                              {CARD_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                        <Input
                          aria-label="Label"
                          placeholder="e.g. Visa Platinum"
                          value={entry.label ?? ''}
                          maxLength={60}
                          onChange={(event) => setPrefix(index, { label: event.target.value })}
                          className="h-9"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove prefix"
                          onClick={() =>
                            setEditing({ ...editing, cardPrefixes: editing.cardPrefixes.filter((_, at) => at !== index) })
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Take these from the bank’s own offer terms. A prefix listed here is honoured for any card that starts with it.
                </p>
              </div>
            </div>
          ) : banks === null ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {banks.map((bank) => (
                <li key={bank.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {bank.name}
                      {bank.shortName ? <span className="text-xs text-muted-foreground">{bank.shortName}</span> : null}
                      {!bank.isActive ? <Badge variant="neutral">Switched off</Badge> : null}
                    </p>
                    <p className={bank.cardPrefixes.length ? 'text-xs text-muted-foreground' : 'text-xs text-warning'}>
                      {bank.cardPrefixes.length
                        ? `${bank.cardPrefixes.length} card ${bank.cardPrefixes.length === 1 ? 'prefix' : 'prefixes'}`
                        : 'No card prefixes — cannot back an offer yet'}
                      {bank.discountCount ? ` · used by ${bank.discountCount} ${bank.discountCount === 1 ? 'discount' : 'discounts'}` : ''}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditing({
                            id: bank.id,
                            name: bank.name,
                            shortName: bank.shortName ?? '',
                            country: bank.country,
                            isActive: bank.isActive,
                            sortOrder: bank.sortOrder,
                            cardPrefixes: bank.cardPrefixes.length ? bank.cardPrefixes : [{ prefix: '', cardType: 'credit', label: null }],
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${bank.name}`} onClick={() => void remove(bank)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </DialogBody>

        <DialogFooter>
          {editing ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Back to the list
              </Button>
              <Button type="button" loading={saving} onClick={() => void save()}>
                {editing.id ? 'Save bank' : 'Add bank'}
              </Button>
            </>
          ) : (
            <>
              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(blank(((banks ?? []).at(-1)?.sortOrder ?? 0) + 10))}
                >
                  <Plus aria-hidden /> Add a bank
                </Button>
              ) : null}
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
