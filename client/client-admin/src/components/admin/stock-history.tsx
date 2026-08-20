'use client';

import * as React from 'react';
import { History } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { InventoryRow, InventoryTransactionRow } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

/** Why a movement happened, in the words an owner would use. */
const REASON: Record<string, string> = {
  purchase: 'Stock received',
  sale: 'Sold',
  reservation: 'Held for an order',
  release: 'Released back',
  adjustment: 'Counted by hand',
  return: 'Returned',
  damage: 'Damaged',
  transfer: 'Moved',
};

/**
 * How a stock level came to be what it is.
 *
 * Every movement writes one of these rows in the same transaction as the change
 * itself, so the ledger cannot disagree with the count — `availableAfter` is a
 * snapshot taken inside that transaction rather than a running total added up
 * here. When a number looks wrong, this is the screen that says who moved it and
 * against which order.
 *
 * Loaded when the dialog opens rather than with the page: a hundred rows per
 * variant across a listing of twenty would be most of the payload and almost
 * none of it read.
 */
export function StockHistory({ row }: { row: InventoryRow }) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<InventoryTransactionRow[] | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open || rows !== null) return;

    let cancelled = false;

    api
      .get<InventoryTransactionRow[]>(`/api/v1/admin/inventory/${row.variantId}/transactions`)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [open, rows, row.variantId]);

  return (
    <>
      <Button size="icon-sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Stock history">
        <History aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Stock history</DialogTitle>
            <DialogDescription>
              {row.productName}
              {row.variantTitle ? ` · ${row.variantTitle}` : ''} · {row.sku}
            </DialogDescription>
          </DialogHeader>

          {/* The one dialog here that is meant to scroll: a ledger has no last
              entry, so there is no width that would contain it. */}
          <div className="max-h-[60vh] overflow-y-auto py-2">
            {error ? <Alert variant="danger">{error}</Alert> : null}

            {rows === null && !error ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : null}

            {rows !== null && rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing has moved yet. The first adjustment will show up here.
              </p>
            ) : null}

            {rows !== null && rows.length > 0 ? (
              <ul className="divide-y">
                {rows.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                    <span
                      className={`w-14 shrink-0 text-right font-medium tabular-nums ${
                        entry.quantity < 0 ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        {REASON[entry.type] ?? entry.type}
                        {entry.toBucket ? (
                          <span className="text-muted-foreground"> · {entry.toBucket.replace('_', ' ')}</span>
                        ) : null}
                      </span>
                      {entry.note || entry.referenceId ? (
                        <span className="block text-xs text-muted-foreground">
                          {[entry.note, entry.referenceId].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </span>

                    <span className="text-right text-xs text-muted-foreground">
                      <span className="block tabular-nums">{entry.availableAfter} left</span>
                      <span className="block">{formatDateTime(entry.createdAt)}</span>
                      {entry.adminLabel ? <span className="block">{entry.adminLabel}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
