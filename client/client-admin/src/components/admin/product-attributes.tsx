'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import type { AttributeRow } from '@/lib/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

/**
 * The descriptive values a product *has* — Material: Cotton, Season: Winter.
 *
 * These narrow a listing; they do not create something separate to buy. A value
 * that decides SKU, price and stock belongs on a **variant** instead, which is
 * the tab below. Attributes marked as variant attributes are shown here greyed
 * with that said plainly rather than hidden, because an owner who has marked one
 * wrongly needs to see why it is not on offer.
 *
 * Each value is sent as an id and the API resolves which attribute it belongs
 * to, so a colour can never be filed under Size by a stale page.
 */
export function ProductAttributes({
  productId,
  attributes,
  selected,
  canManage,
}: {
  productId: string;
  attributes: AttributeRow[];
  selected: string[];
  canManage: boolean;
}) {
  const router = useRouter();

  const [chosen, setChosen] = React.useState<Set<string>>(() => new Set(selected));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const descriptive = attributes.filter((attribute) => !attribute.isVariantAttribute);
  const variantOnly = attributes.filter((attribute) => attribute.isVariantAttribute);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      await api.put(`/api/v1/admin/products/${productId}/attributes`, {
        attributeValueIds: [...chosen],
      });
      toast.success('Attributes saved.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attributes</CardTitle>
        <CardDescription>
          Facts about the product that shoppers filter by. Options they choose between when buying belong on a
          variant instead.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {attributes.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No attributes exist yet. <Link href="/attributes" className="underline">Create one</Link> to filter your
            listings by it.
          </p>
        ) : null}

        {descriptive.map((attribute) => (
          <div key={attribute.id} className="space-y-2">
            <p className="text-sm font-medium">
              {attribute.name}
              {attribute.unit ? <span className="text-muted-foreground"> ({attribute.unit})</span> : null}
            </p>

            {attribute.values.length === 0 ? (
              <p className="text-xs text-muted-foreground">No values on this attribute yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {attribute.values.map((value) => {
                  const active = chosen.has(value.id);
                  return (
                    <button
                      key={value.id}
                      type="button"
                      onClick={() => toggle(value.id)}
                      disabled={!canManage}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input hover:bg-muted',
                        !canManage && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      {value.colorHex ? (
                        <span
                          className="size-3 rounded-full border"
                          style={{ backgroundColor: value.colorHex }}
                          aria-hidden
                        />
                      ) : null}
                      {value.value}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {variantOnly.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {variantOnly.map((attribute) => attribute.name).join(', ')}{' '}
            {variantOnly.length === 1 ? 'is a variant attribute' : 'are variant attributes'} — set{' '}
            {variantOnly.length === 1 ? 'it' : 'them'} on each variant below.
          </p>
        ) : null}

        {canManage && descriptive.length > 0 ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={save} loading={saving}>
              Save attributes
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
