'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useT } from '@/lib/i18n';

/** Four is a bundle a shopper reads; more is a category listing. */
const LIMIT = 4;

export interface BundleCandidate {
  id: string;
  name: string;
}

/**
 * "Frequently bought together", chosen rather than mined.
 *
 * With a handful of orders, mining order history recommends whatever the last
 * customer happened to buy. The storefront also prices the bundle from these
 * rows, so an owner needs to be able to say what belongs in it.
 *
 * The candidate list is the store's products as of this page load. It is
 * filtered in the browser rather than re-queried per keystroke because the list
 * is already here and a bundle is picked from a handful of obvious companions,
 * not searched for across a catalogue.
 */
export function ProductBundle({
  productId,
  candidates,
  selected,
  canManage,
}: {
  productId: string;
  candidates: BundleCandidate[];
  selected: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const t = useT();

  const [chosen, setChosen] = React.useState<string[]>(selected);
  const [term, setTerm] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const nameOf = React.useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate.name])),
    [candidates],
  );

  const matches = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    return candidates
      .filter((candidate) => candidate.id !== productId && !chosen.includes(candidate.id))
      .filter((candidate) => needle === '' || candidate.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [candidates, chosen, term, productId]);

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      await api.put(`/api/v1/admin/products/${productId}/bundle`, { relatedProductIds: chosen });
      toast.success(chosen.length === 0 ? t('Bundle cleared.') : t('Bundle saved.'));
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
        <CardTitle>{t('Bought together')}</CardTitle>
        <CardDescription>
          {t(
            'Up to {limit} products offered alongside this one. The storefront prices the bundle from what you choose here.',
            { limit: LIMIT },
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {chosen.length === 0 ? (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
            {t('Nothing paired with this product yet.')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {chosen.map((id) => (
              <li key={id}>
                <Badge variant="neutral" className="gap-1.5 py-1 pr-1 pl-3">
                  {nameOf.get(id) ?? t('A product not in this list')}
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setChosen((current) => current.filter((item) => item !== id))}
                      aria-label={
                        nameOf.has(id) ? t('Remove {name}', { name: nameOf.get(id)! }) : t('Remove product')
                      }
                      className="rounded-full p-0.5 hover:bg-background/60"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={t('Search your products')}
                className="pl-9"
                disabled={chosen.length >= LIMIT}
                aria-label={t('Search products to pair')}
              />
            </div>

            {chosen.length >= LIMIT ? (
              <p className="text-xs text-muted-foreground">
                {t('That is the maximum. Remove one to pair something else.')}
              </p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('No other products match.')}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {matches.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosen((current) => [...current, candidate.id]);
                        setTerm('');
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      {candidate.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={save} loading={saving}>
                {t('Save bundle')}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
