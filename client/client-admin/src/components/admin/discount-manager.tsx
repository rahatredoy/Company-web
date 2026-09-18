'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Copy, Eye, Landmark, Pause, Pencil, Play, Plus, Settings2, Trash2 } from 'lucide-react';
import type { DiscountReference, DiscountRow, DiscountSummary } from '@/lib/types';
import { api, errorMessage, type ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import { formatMoney, formatNumber } from '@/lib/format';
import {
  KIND_META,
  STATE_META,
  STRATEGY_META,
  conditionPhrases,
  customerText,
  offerText,
  scheduleText,
  usageText,
} from '@/lib/discounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { InfiniteTable, type Column } from './infinite-table';
import { DiscountDetail } from './discount-detail';
import { DiscountEditor } from './discount-editor';
import { DiscountStrategyDialog } from './discount-strategy';
import { BankManager } from './bank-manager';

const SELECT_CLASS = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

/**
 * The Discounts screen: every coupon, automatic offer, voucher, campaign, bank
 * and payment offer, in one list.
 *
 * The state column is the API's (`draft`, `scheduled`, `active`, `paused`,
 * `expired`, `limit_reached`) — read off the clock and the counter at the moment
 * of asking — so the panel never decides for itself whether a sale has ended.
 * `Used` is never editable: it is claimed inside the order transaction.
 */
export function DiscountManager({
  initial,
  query,
  summary,
  reference,
  canManage,
  kindOptions,
}: {
  /** The first batch, rendered on the server. The rest arrive by cursor. */
  initial: { rows: DiscountRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  summary: DiscountSummary;
  reference: DiscountReference;
  canManage: boolean;
  kindOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const list = useInfiniteList<DiscountRow>({ path: '/api/v1/admin/discounts', query, initial });

  const currency = reference.currency;
  const viewing = useViewTarget<DiscountRow>();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  // Bumped on every opening, so the editor mounts with a fresh form each time.
  const [editorKey, setEditorKey] = React.useState(0);
  const [strategyOpen, setStrategyOpen] = React.useState(false);
  const [banksOpen, setBanksOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const openEditor = (id: string | null) => {
    setEditingId(id);
    setEditorKey((value) => value + 1);
    setEditorOpen(true);
  };

  const setKind = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('kind', value);
    else params.delete('kind');
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname);
  };

  const run = async (row: DiscountRow, work: () => Promise<string>) => {
    if (busy) return;
    setBusy(row.id);
    try {
      toast.success(await work());
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (row: DiscountRow) =>
    run(row, async () => {
      const next = row.status === 'active' ? 'paused' : 'active';
      await api.patch(`/api/v1/admin/discounts/${row.id}/status`, { status: next });
      return next === 'active' ? `${row.name} is switched on.` : `${row.name} is paused.`;
    });

  const duplicate = (row: DiscountRow) =>
    run(row, async () => {
      await api.post(`/api/v1/admin/discounts/${row.id}/duplicate`);
      return 'Copy saved as a draft.';
    });

  const remove = (row: DiscountRow) => {
    if (!window.confirm(`Delete “${row.name}”?`)) return;
    void run(row, async () => {
      // A discount that was used is archived rather than deleted; the API says so.
      const result = await api.delete<{ message?: string } | undefined>(`/api/v1/admin/discounts/${row.id}`);
      return result?.message ?? 'Discount deleted.';
    });
  };

  const namesFor = (row: DiscountRow) => (id: string) => row.labels[id];

  const columns: Column<DiscountRow>[] = [
    {
      key: 'name',
      width: '16rem',
      header: 'Discount',
      cell: (row) => (
        <>
          <span className="block truncate font-medium">{row.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.code ? <span className="font-mono">{row.code}</span> : 'No code'} · {KIND_META[row.kind].short}
          </span>
        </>
      ),
    },
    {
      key: 'offer',
      width: '11rem',
      header: 'Offer',
      cell: (row) => (
        <>
          <span className="block truncate font-medium">{offerText(row, currency)}</span>
          {row.maxDiscountAmount ? (
            <span className="block truncate text-xs text-muted-foreground">
              Max {formatMoney(row.maxDiscountAmount, currency)}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'conditions',
      header: 'Conditions',
      className: 'text-sm text-muted-foreground',
      cell: (row) => {
        const phrases = conditionPhrases(row, currency, namesFor(row));
        return (
          <>
            <span className="block truncate">{phrases.length ? phrases.join(' · ') : 'Any basket'}</span>
            <span className="block truncate text-xs">{customerText(row)}</span>
          </>
        );
      },
    },
    {
      key: 'runs',
      width: '10rem',
      header: 'Runs',
      className: 'text-sm text-muted-foreground',
      cell: (row) => scheduleText(row, row.resolvedTimezone),
    },
    {
      key: 'used',
      width: '7rem',
      header: 'Used',
      headClassName: 'text-right',
      className: 'text-right tabular-nums',
      cell: (row) => usageText(row),
    },
    {
      key: 'state',
      width: '8rem',
      header: 'Status',
      cell: (row) => <Badge variant={STATE_META[row.state].variant}>{STATE_META[row.state].label}</Badge>,
    },
    {
      key: 'actions',
      width: canManage ? '13rem' : '4rem',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => viewing.view(row)} aria-label={`View ${row.name}`}>
            <Eye aria-hidden />
          </Button>
          {canManage ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => openEditor(row.id)} aria-label={`Edit ${row.name}`}>
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === row.id}
                onClick={() => void toggle(row)}
                aria-label={row.status === 'active' ? `Pause ${row.name}` : `Switch on ${row.name}`}
                title={row.status === 'active' ? 'Pause' : 'Switch on'}
              >
                {row.status === 'active' ? <Pause aria-hidden /> : <Play aria-hidden />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === row.id}
                onClick={() => void duplicate(row)}
                aria-label={`Duplicate ${row.name}`}
                title="Duplicate"
              >
                <Copy aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === row.id}
                onClick={() => remove(row)}
                aria-label={`Delete ${row.name}`}
              >
                <Trash2 aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const tiles = [
    { label: 'Active', value: formatNumber(summary.active), sub: `${formatNumber(summary.scheduled)} scheduled` },
    { label: 'Paused or draft', value: formatNumber(summary.paused + summary.draft), sub: `${formatNumber(summary.expired)} expired` },
    { label: 'Uses', value: formatNumber(summary.redemptions), sub: `${formatNumber(summary.redemptionsLast30Days)} in the last 30 days` },
    {
      label: 'Discount given',
      value: formatMoney(summary.discountGiven, summary.currency),
      sub: `across ${formatNumber(summary.discountedOrders)} orders`,
    },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{tile.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{tile.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <Button size="sm" onClick={() => openEditor(null)}>
            <Plus aria-hidden /> New discount
          </Button>
        ) : null}
        <select
          aria-label="Type of discount"
          className={SELECT_CLASS}
          value={query.kind ?? ''}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">Every type</option>
          {kindOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStrategyOpen(true)}
            disabled={!canManage}
            title={STRATEGY_META[reference.strategy].description}
          >
            <Settings2 aria-hidden /> {STRATEGY_META[reference.strategy].label}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBanksOpen(true)}>
            <Landmark aria-hidden /> Manage banks
          </Button>
        </div>
      </div>

      <InfiniteTable
        columns={columns}
        rows={list.rows}
        total={list.total}
        noun="discount"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        minWidth="72rem"
        estimateRowHeight={62}
        empty="No discounts yet."
      />

      {canManage ? (
        <DiscountEditor
          key={editorKey}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          discountId={editingId}
          reference={reference}
          onOpenBanks={() => setBanksOpen(true)}
        />
      ) : null}

      <DiscountDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        onEdit={
          canManage
            ? (id) => {
                viewing.onOpenChange(false);
                openEditor(id);
              }
            : undefined
        }
      />

      <DiscountStrategyDialog key={String(strategyOpen)} open={strategyOpen} onOpenChange={setStrategyOpen} current={reference.strategy} />
      <BankManager
        key={String(banksOpen)}
        open={banksOpen}
        onOpenChange={(open) => {
          setBanksOpen(open);
          if (!open) router.refresh();
        }}
        canManage={canManage}
      />
    </>
  );
}
