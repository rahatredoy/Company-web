'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { DiscountStrategy } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { STRATEGY_META } from '@/lib/discounts';
import { Alert } from '@/components/ui/alert';
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
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

/**
 * What the store does when more than one automatic discount matches a basket.
 *
 * A store-wide choice rather than a field on each discount, because it is a
 * decision about how discounts meet each other — no single discount can own it.
 * Codes the shopper types are not affected: they are the shopper's choice, and
 * whether one sits beside another is each discount's own combination rules.
 */
export function DiscountStrategyDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: DiscountStrategy;
}) {
  const router = useRouter();
  const [choice, setChoice] = React.useState<DiscountStrategy>(current);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  // The caller remounts this per opening (a fresh `key`), so the choice starts from what is saved.

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/api/v1/admin/discounts/settings', { strategy: choice });
      toast.success('Checkout rules saved.');
      onOpenChange(false);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>When several automatic discounts match</DialogTitle>
          <DialogDescription>
            Applies to discounts that need no code. Each discount’s own combination rules still decide what it may sit beside.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div role="radiogroup" aria-label="Strategy" className="space-y-2">
            {(Object.keys(STRATEGY_META) as DiscountStrategy[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={choice === key}
                onClick={() => setChoice(key)}
                className={cn(
                  'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                  choice === key ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
                )}
              >
                <span className="block text-sm font-medium">{STRATEGY_META[key].label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{STRATEGY_META[key].description}</span>
              </button>
            ))}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
