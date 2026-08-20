'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Boxes,
  Coins,
  Download,
  Eye,
  Info,
  Package,
  PackageX,
  Pencil,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toaster';
import { apiFetchListed, errorMessage, type ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import { formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { formatStock } from '@/lib/measure';
import { cn } from '@/lib/utils';
import type { InventoryRow, InventoryStats, WarehouseRow } from '@/lib/types';
import { InfiniteTable, type Column } from './infinite-table';
import { InventoryDetail } from './inventory-detail';
import { LazyImage } from './lazy-image';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { StockAdjuster } from './stock-adjuster';
import { StockHistory } from './stock-history';
import { WarehouseManager } from './warehouse-manager';
import { SELECT_CLASS } from './category-tree';

/**
 * Stock levels, and the warehouses they are counted in.
 *
 * Emptiest first by default, because the list exists to be acted on and the rows
 * that need acting on are the ones about to run out. Server-filtered, and read a
 * batch at a time as the reader scrolls — a catalogue's worth of levels is one
 * row per variant per warehouse, which makes this the largest table in the panel
 * and the one that most needed to stop being paged through by hand.
 *
 * Two things worth knowing about the numbers. **Reserved is already out of
 * available**: it is committed to orders that have not shipped, so the two never
 * need adding together. And a variant with *no* level row at all is not "zero" —
 * it is untracked, and unsellable, which is why the tally counts those separately
 * and the empty state says so.
 */

export type StockSort = 'available' | 'reserved' | 'product' | 'warehouse' | 'updatedAt';

export interface InventoryFilterState {
  search: string;
  status: 'all' | 'in_stock' | 'low' | 'out';
  warehouseId: string;
  sort: StockSort;
  order: 'asc' | 'desc';
}

export const INVENTORY_DEFAULTS: InventoryFilterState = {
  search: '',
  status: 'all',
  warehouseId: '',
  sort: 'available',
  order: 'asc',
};

/** Exactly what the API is asked for, so the first batch and the rest agree. */
function queryFor(filters: InventoryFilterState) {
  return {
    search: filters.search.trim() || undefined,
    status: filters.status,
    warehouseId: filters.warehouseId || undefined,
    sort: filters.sort,
    order: filters.order,
  };
}

/**
 * A sorting column header. Declared at module scope: a component created during
 * render is a new type every pass, and React remounts it.
 */
function SortButton({
  sort,
  children,
  active,
  order,
  onSort,
}: {
  sort: StockSort;
  children: React.ReactNode;
  active: StockSort;
  order: 'asc' | 'desc';
  onSort: (sort: StockSort) => void;
}) {
  const on = active === sort;

  return (
    <button
      type="button"
      onClick={() => onSort(sort)}
      aria-label={`Sort by ${String(children)}`}
      className={cn(
        'inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground',
        on && 'text-foreground',
      )}
    >
      {children}
      {on ? (
        order === 'asc' ? (
          <ArrowUp className="size-3" aria-hidden />
        ) : (
          <ArrowDown className="size-3" aria-hidden />
        )
      ) : null}
    </button>
  );
}

export function InventoryManager({
  initial,
  stats,
  warehouses,
  unitsByWarehouse,
  currency,
  canAdjust,
  filters,
}: {
  /** The first batch, rendered on the server. The rest arrive by cursor. */
  initial: { rows: InventoryRow[]; meta: ListMeta };
  stats: InventoryStats | null;
  warehouses: WarehouseRow[];
  unitsByWarehouse: Record<string, number>;
  currency: string;
  canAdjust: boolean;
  filters: InventoryFilterState;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const query = React.useMemo(() => queryFor(filters), [filters]);
  const list = useInfiniteList<InventoryRow>({ path: '/api/v1/admin/inventory', query, initial });

  /*
   * The read-only panel.
   *
   * `StockHistory` beside it opens the ledger for the *variant*, across every
   * warehouse — that is what `/inventory/:id/transactions` is keyed by. This
   * one is the level: five buckets, the variant, the product's own
   * `track_inventory`, this warehouse's movements, and the same variant's
   * stock in the others.
   */
  const viewing = useViewTarget<InventoryRow>();
  const rows = list.rows;

  const [term, setTerm] = React.useState(filters.search);
  const [adjusting, setAdjusting] = React.useState<InventoryRow | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const [lastSearch, setLastSearch] = React.useState(filters.search);
  if (filters.search !== lastSearch) {
    setLastSearch(filters.search);
    setTerm(filters.search);
  }

  // ------------------------------------------------------------------ url

  const urlFor = (patch: Partial<InventoryFilterState>): string => {
    const next: InventoryFilterState = { ...filters, ...patch };

    const params = new URLSearchParams();
    if (next.search.trim()) params.set('search', next.search.trim());
    if (next.status !== 'all') params.set('status', next.status);
    if (next.warehouseId) params.set('warehouse', next.warehouseId);
    if (next.sort !== INVENTORY_DEFAULTS.sort) params.set('sort', next.sort);
    if (next.order !== INVENTORY_DEFAULTS.order) params.set('order', next.order);

    const query = params.toString();
    return query ? `/inventory?${query}` : '/inventory';
  };

  const apply = (patch: Partial<InventoryFilterState>) => {
    startTransition(() => router.push(urlFor(patch)));
  };

  const sortBy = (sort: StockSort) =>
    apply(
      filters.sort === sort
        ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
        : // Counts read low-first (that is the point of the screen); names A→Z.
          { sort, order: sort === 'product' || sort === 'warehouse' ? 'asc' : 'asc' },
    );

  const filtering = filters.search.trim() !== '' || filters.status !== 'all' || filters.warehouseId !== '';

  // --------------------------------------------------------------- export

  /*
   * Read by cursor, not by page number: an export of two thousand rows is twenty
   * reads, and the twentieth would otherwise make the database walk past
   * nineteen hundred rows to reach the ones it wants.
   */
  const EXPORT_CAP = 2000;
  const EXPORT_BATCH = 100;

  async function exportCsv() {
    setExporting(true);
    try {
      const collected: InventoryRow[] = [];
      let cursor: string | null | undefined;

      while (collected.length < EXPORT_CAP) {
        const batch = await apiFetchListed<InventoryRow>('/api/v1/admin/inventory', {
          query: { ...query, pageSize: EXPORT_BATCH, cursor: cursor ?? undefined },
        });
        collected.push(...batch.data);
        cursor = batch.meta.nextCursor;
        if (!batch.meta.hasMore || !cursor) break;
      }

      const header = [
        'product',
        'variant',
        'sku',
        'warehouse',
        'available',
        'reserved',
        'incoming',
        'damaged',
        'returns_pending',
        'warn_at',
        'cost_price',
        'value_at_cost',
        'updated_at',
      ];
      const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

      const body = collected.map((row) =>
        [
          row.productName,
          row.variantTitle ?? '',
          row.sku,
          row.warehouseName,
          row.measureUnit ? formatStock(row.available, row.measureUnit) : row.available,
          row.reserved,
          row.incoming,
          row.damaged,
          row.returnPending,
          row.lowStockThreshold,
          row.costPrice ?? '',
          row.costPrice ? (Number(row.costPrice) * row.available).toFixed(2) : '',
          row.updatedAt,
        ]
          .map(cell)
          .join(','),
      );

      const blob = new Blob([[header.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'stock-levels.csv';
      link.click();
      URL.revokeObjectURL(url);

      if (list.total !== null && list.total > collected.length) {
        toast.error(`Exported the first ${formatNumber(collected.length)} of ${formatNumber(list.total)}.`);
      } else {
        toast.success(`Exported ${formatNumber(collected.length)} row${collected.length === 1 ? '' : 's'}.`);
      }
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  // ----------------------------------------------------------------- view

  /*
   * Columns as data. A virtualised table only ever holds the rows on screen, so
   * it cannot size its columns from its contents — `InfiniteTable` declares them
   * in a `<colgroup>` and lays the table out fixed. `Product` carries no width:
   * it is the column that absorbs whatever is left.
   */
  const columns: Column<InventoryRow>[] = [
    {
      key: 'product',
      header: (
        <SortButton sort="product" active={filters.sort} order={filters.order} onSort={sortBy}>
          Product
        </SortButton>
      ),
      cell: (row) => (
        <div className="flex items-center gap-3">
          <LazyImage
            src={row.imageUrl}
            alt=""
            className="size-10 rounded-lg border border-border"
            fallback={
              <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                <Package className="size-4" />
              </span>
            }
          />
          <div className="min-w-0">
            <Link href={`/products/${row.productId}`} className="block truncate font-semibold hover:underline">
              {row.productName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{row.sku}</span>
              {row.variantTitle ? ` \u00b7 ${row.variantTitle}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'warehouse',
      width: '11rem',
      className: 'text-sm text-muted-foreground',
      header: (
        <SortButton sort="warehouse" active={filters.sort} order={filters.order} onSort={sortBy}>
          Warehouse
        </SortButton>
      ),
      cell: (row) => <span className="block truncate">{row.warehouseName}</span>,
    },
    {
      key: 'available',
      width: '11rem',
      headClassName: 'text-right',
      className: 'text-right',
      header: (
        <SortButton sort="available" active={filters.sort} order={filters.order} onSort={sortBy}>
          Available
        </SortButton>
      ),
      cell: (row) => {
        const out = row.available <= 0;
        const low = !out && row.available <= row.lowStockThreshold;

        return (
          <>
            <div className="flex items-center justify-end gap-2">
              {/*
                Counted in base units for a product sold by weight, so 40000 is
                printed as "40kg". A bare number here would tell the owner they
                have forty thousand pumpkins.
              */}
              <span className="font-semibold tabular-nums">
                {row.measureUnit ? formatStock(row.available, row.measureUnit) : formatNumber(row.available)}
              </span>
              {out ? <Badge variant="danger">Out</Badge> : low ? <Badge variant="warning">Low</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">warn at {row.lowStockThreshold}</p>
          </>
        );
      },
    },
    {
      key: 'reserved',
      width: '7.5rem',
      headClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      header: (
        <SortButton sort="reserved" active={filters.sort} order={filters.order} onSort={sortBy}>
          Reserved
        </SortButton>
      ),
      cell: (row) =>
        row.measureUnit ? formatStock(row.reserved, row.measureUnit) : formatNumber(row.reserved),
    },
    {
      key: 'incoming',
      width: '9rem',
      headClassName: 'text-right',
      className: 'text-right text-sm tabular-nums text-muted-foreground',
      header: (
        <span className="inline-flex items-center gap-1.5 uppercase">
          Incoming
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="What these buckets mean">
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              <b>Available</b> — sellable now. <b>Reserved</b> — committed to orders that have not shipped,
              already out of available. <b>Incoming</b> — on order. Damaged and returned units are never
              sellable.
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => (
        <>
          {formatNumber(row.incoming)}
          {row.damaged > 0 || row.returnPending > 0 ? (
            <p className="text-xs">
              {row.damaged > 0 ? `${formatNumber(row.damaged)} damaged` : null}
              {row.damaged > 0 && row.returnPending > 0 ? ' \u00b7 ' : null}
              {row.returnPending > 0 ? `${formatNumber(row.returnPending)} returns` : null}
            </p>
          ) : null}
        </>
      ),
    },
    {
      key: 'updated',
      width: '9rem',
      className: 'text-sm text-muted-foreground',
      header: (
        <SortButton sort="updatedAt" active={filters.sort} order={filters.order} onSort={sortBy}>
          Updated
        </SortButton>
      ),
      cell: (row) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{formatRelative(row.updatedAt)}</span>
          </TooltipTrigger>
          <TooltipContent>{new Date(row.updatedAt).toLocaleString()}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'actions',
      width: '10rem',
      headClassName: 'text-right',
      header: 'Actions',
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`View the stock record for ${row.productName}`}
                onClick={() => viewing.view(row)}
              >
                <Eye />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View every detail</TooltipContent>
          </Tooltip>

          <StockHistory row={row} />

          {canAdjust ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setAdjusting(row)}
                  aria-label={`Adjust ${row.productName}`}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Adjust stock</TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" asChild>
                <Link href={`/products/${row.productId}`} aria-label="Open the product">
                  <ArrowUpRight />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open the product</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PageHeader
          title="Inventory"
          breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inventory' }]}
          actions={
            <Button variant="outline" onClick={exportCsv} loading={exporting} disabled={rows.length === 0}>
              {exporting ? null : <Download />} Export
            </Button>
          }
        />

        {/* ---------------------------------------------------------- stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Boxes}
            tint="primary"
            label="Units in Stock"
            value={formatNumber(stats?.unitsAvailable ?? 0)}
            note={
              stats
                ? `${formatNumber(stats.tracked)} tracked SKU${stats.tracked === 1 ? '' : 's'} · ${formatNumber(stats.unitsReserved)} reserved`
                : 'Sellable right now'
            }
          />
          <StatCard
            icon={TriangleAlert}
            tint="warning"
            label="Low Stock"
            value={formatNumber(stats?.low ?? 0)}
            note="At or below their warning line"
            href={stats && stats.low > 0 ? '/inventory?status=low' : undefined}
          />
          <StatCard
            icon={PackageX}
            tint="danger"
            label="Out of Stock"
            value={formatNumber(stats?.out ?? 0)}
            note={
              stats && stats.untrackedVariants > 0
                ? `${formatNumber(stats.untrackedVariants)} variant${stats.untrackedVariants === 1 ? '' : 's'} never counted`
                : 'Nothing left to sell'
            }
            href={stats && stats.out > 0 ? '/inventory?status=out' : undefined}
          />
          <StatCard
            icon={Coins}
            tint="success"
            label="Stock Value"
            value={formatMoney(stats?.valueAtCost ?? 0, currency)}
            note="Available units at cost price"
          />
        </div>

        <Tabs defaultValue="levels" className="space-y-6">
          <TabsList>
            <TabsTrigger value="levels">Stock levels</TabsTrigger>
            <TabsTrigger value="warehouses">Warehouses ({warehouses.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="levels" className="space-y-6">
            {/* ---------------------------------------------------- filters */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                apply({ search: term });
              }}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center"
            >
              <div className="relative w-full lg:max-w-xs">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Product name or SKU…"
                  aria-label="Search stock"
                  className="pl-9"
                />
              </div>

              <select
                value={filters.status}
                onChange={(event) => apply({ status: event.target.value as InventoryFilterState['status'] })}
                aria-label="Stock status"
                className={cn(SELECT_CLASS, 'lg:w-44')}
              >
                <option value="all">All Stock</option>
                <option value="in_stock">In stock</option>
                <option value="low">Running low</option>
                <option value="out">Out of stock</option>
              </select>

              <select
                value={filters.warehouseId}
                onChange={(event) => apply({ warehouseId: event.target.value })}
                aria-label="Warehouse"
                className={cn(SELECT_CLASS, 'lg:w-52')}
              >
                <option value="">All Warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                    {warehouse.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2 lg:ml-auto">
                <Button type="submit" variant="outline">
                  <SlidersHorizontal /> Filter
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setTerm('');
                        startTransition(() => router.push('/inventory'));
                      }}
                      aria-label="Reset filters"
                    >
                      <RotateCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset filters</TooltipContent>
                </Tooltip>
              </div>
            </form>

            {/* ------------------------------------------------------ table */}
            <InfiniteTable
              columns={columns}
              rows={rows}
              total={list.total}
              noun="record"
              hasMore={list.hasMore}
              loading={list.loading}
              error={list.error}
              onLoadMore={list.loadMore}
              onRetry={list.retry}
              dimmed={pending}
              minWidth="72rem"
              estimateRowHeight={68}
              maxHeight="calc(100svh - 26rem)"
              empty={
                filtering
                  ? 'No stock matches these filters.'
                  : 'Nothing is being tracked yet. A variant with no stock record cannot be sold — adjust one to start counting it.'
              }
            />
          </TabsContent>

          <TabsContent value="warehouses">
            <WarehouseManager
              rows={warehouses}
              canManage={canAdjust}
              unitsByWarehouse={unitsByWarehouse}
            />
          </TabsContent>
        </Tabs>

        <InventoryDetail
          row={viewing.row}
          open={viewing.open}
          onOpenChange={viewing.onOpenChange}
          currency={currency}
        />

        <StockAdjuster
          row={adjusting}
          open={adjusting !== null}
          onOpenChange={(open) => {
            if (!open) setAdjusting(null);
          }}
          onSaved={() => router.refresh()}
        />
      </div>
    </TooltipProvider>
  );
}
