'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Info,
  Layers,
  MoreVertical,
  Package,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Store,
  TriangleAlert,
  Trash2,
  Warehouse,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toaster';
import { api, apiFetchListed, errorMessage, type ListMeta } from '@/lib/api';
import { formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { PRODUCT_LIST_SORT } from '@/lib/list';
import { cn } from '@/lib/utils';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { BrandRow, CategoryRow, ProductRow, ProductStats, ProductStatus } from '@/lib/types';
import { InfiniteTable, type Column } from './infinite-table';
import { ProductDetail } from './product-detail';
import { LazyImage } from './lazy-image';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { ProductCreatePanel } from './product-form';
import { ProductQuickEdit } from './product-quick-edit';
import { SELECT_CLASS, tintFor } from './category-tree';

/**
 * The product list, and every write that can be made from it.
 *
 * Unlike the category tree, this is **server-filtered**: a catalogue is measured
 * in thousands, so the filters travel in the URL and the server re-reads rather
 * than the browser holding the whole set. Every filter control therefore ends in
 * a `router.push`, and `useTransition` is what keeps the table on screen —
 * dimmed — while the next read arrives instead of blanking it.
 *
 * The list itself does **not** page. The server renders the first batch and
 * `useInfiniteList` appends the rest by cursor as the reader nears the bottom,
 * while `InfiniteTable` keeps only the visible rows in the DOM. A thousand-row
 * catalogue is therefore one table the reader scrolls, not fifty they click
 * through, and the DOM stays the size of a screenful either way.
 *
 * The four figures at the top come from `GET /products/stats`, counted in the
 * database. Deriving them from the rows on screen would describe what has been
 * scrolled past rather than the catalogue.
 */

const TINTS = [
  'bg-primary-soft text-accent-foreground',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-destructive-soft text-destructive',
  'bg-accent text-accent-foreground',
] as const;

const STATUS_TONE: Record<ProductStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  draft: 'warning',
  inactive: 'neutral',
};

const STATUS_LABEL: Record<ProductStatus, string> = {
  active: 'Active',
  draft: 'Draft',
  inactive: 'Inactive',
};

export type ProductSort = 'createdAt' | 'updatedAt' | 'name' | 'price' | 'sold' | 'stock';

/**
 * What the list is showing. There is no page number and no page size: the list
 * scrolls, so its extent is how far the reader has gone rather than a coordinate
 * that has to survive in the URL.
 */
export interface ProductFilterState {
  search: string;
  status: 'all' | ProductStatus;
  categoryId: string;
  brandId: string;
  stock: 'all' | 'in_stock' | 'low' | 'out' | 'untracked';
  featured: 'all' | 'yes' | 'no';
  sort: ProductSort;
  order: 'asc' | 'desc';
}

export const PRODUCT_DEFAULTS: ProductFilterState = {
  search: '',
  status: 'all',
  categoryId: '',
  brandId: '',
  stock: 'all',
  featured: 'all',
  // From `lib/list.ts`, because the server component that renders the first batch
  // needs the same two values and cannot read them out of this module.
  sort: PRODUCT_LIST_SORT.sort,
  order: PRODUCT_LIST_SORT.order,
};

/** Exactly what the API is asked for, so the first batch and the rest agree. */
function queryFor(filters: ProductFilterState) {
  return {
    search: filters.search.trim() || undefined,
    status: filters.status,
    categoryId: filters.categoryId || undefined,
    brandId: filters.brandId || undefined,
    stock: filters.stock,
    featured: filters.featured,
    sort: filters.sort,
    order: filters.order,
  };
}

/**
 * A sorting column header. Declared at module scope, not inside the screen: a
 * component created during render is a new type on every pass, and React
 * remounts it — which throws away the focus ring the moment a sort is applied.
 */
function SortButton({
  sort,
  children,
  active,
  order,
  onSort,
  label,
}: {
  sort: ProductSort;
  children: React.ReactNode;
  active: ProductSort;
  order: 'asc' | 'desc';
  onSort: (sort: ProductSort) => void;
  /** Spoken name, when the visible one is not a plain string. */
  label?: string;
}) {
  const on = active === sort;

  return (
    <button
      type="button"
      onClick={() => onSort(sort)}
      aria-label={`Sort by ${label ?? String(children)}`}
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

/**
 * How a product's stock reads, using the same buckets the inventory screen does.
 *
 * Four states, not three, and they have to stay apart: **not counted** is a
 * variant nobody has ever recorded a level for, **not tracked** is the owner
 * saying stock may never refuse a sale, and both read as zero available while
 * meaning opposite things. Only the third is a shop that has genuinely sold out.
 */
function stockOf(row: ProductRow): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string } {
  if (!row.trackInventory) return { tone: 'neutral', label: 'Not tracked' };
  if (row.stockRecords === 0) return { tone: 'neutral', label: 'Not counted' };
  if (row.stock <= 0) return { tone: 'danger', label: 'Out of stock' };
  if (row.stock <= row.lowStockThreshold) return { tone: 'warning', label: 'Low stock' };
  return { tone: 'success', label: 'In stock' };
}

/**
 * What the shop keeps of each sale, as a percentage of what it charges.
 *
 * Against the **sale** price when there is one, because that is what a customer
 * actually pays — measuring margin against a ticket price nobody is charged
 * flatters every discounted line on the list. Null rather than zero when there
 * is no cost recorded: an unknown margin and a margin of nothing are different
 * answers, and only one of them is worth chasing.
 */
/**
 * A date short enough for a 6.75rem column.
 *
 * The year is dropped when it is this one, because in a column whose line above
 * it already says "4 days ago" the year is four characters saying nothing — and
 * kept otherwise, because that is exactly when it is the whole point.
 */
function shortDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' }),
  }).format(date);
}

function marginOf(row: ProductRow): number | null {
  const charged = Number(row.salePriceFrom ?? row.priceFrom);
  const cost = row.costPrice === null ? null : Number(row.costPrice);
  if (cost === null || !Number.isFinite(charged) || charged <= 0) return null;
  return ((charged - cost) / charged) * 100;
}

export function ProductManager({
  initial,
  stats,
  categories,
  brands,
  currency,
  permissions,
  storefrontBase,
  storeMeasureOptions,
  filters,
  openCreate = false,
}: {
  /** The first batch, rendered on the server. The rest arrive by cursor. */
  initial: { rows: ProductRow[]; meta: ListMeta };
  stats: ProductStats | null;
  categories: Pick<CategoryRow, 'id' | 'name' | 'parentId'>[];
  brands: Pick<BrandRow, 'id' | 'name'>[];
  currency: string;
  permissions: { create: boolean; update: boolean; delete: boolean };
  /** Storefront origin, for the preview link. Null on a host we cannot read. */
  storefrontBase: string | null;
  /** The shop's default size picker, for a product sold by weight or volume. */
  storeMeasureOptions?: { label: string; measure: number }[];
  filters: ProductFilterState;
  /**
   * `?new=1` — the create panel opened by a link from somewhere else, which is
   * what the retired `/products/new` route redirects to.
   */
  openCreate?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const query = React.useMemo(() => queryFor(filters), [filters]);
  const list = useInfiniteList<ProductRow>({
    path: '/api/v1/admin/products',
    query,
    initial,
  });
  const rows = list.rows;

  const [term, setTerm] = React.useState(filters.search);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [editing, setEditing] = React.useState<ProductRow | null>(null);
  /*
   * The view panel, which is what `Eye` now opens.
   *
   * It used to open the storefront, which answers a different question: the
   * shop's page shows a price and a picture and says nothing about cost, stock
   * buckets, SKUs or the variants that are switched off. The storefront is
   * still one click away, under the `Store` icon beside it.
   */
  const viewing = useViewTarget<ProductRow>();
  const [creating, setCreating] = React.useState(openCreate);

  // A link that arrives with `?new=1` opens the panel; a link that arrives
  // without it closes one opened that way, so the back button works on it.
  const [lastOpenCreate, setLastOpenCreate] = React.useState(openCreate);
  if (openCreate !== lastOpenCreate) {
    setLastOpenCreate(openCreate);
    setCreating(openCreate);
  }

  /*
   * A selection cannot outlive the rows it was made from: acting on an id that
   * is no longer listed would write to a product the user can no longer see.
   * Keyed on the *first* batch rather than on every row, so scrolling more rows
   * in — which only ever appends — does not throw the selection away. Cleared
   * during render rather than in an effect, which would leave one frame where
   * the checkboxes disagreed with the table.
   */
  const signature = initial.rows.map((row) => row.id).join(',');
  const [lastSignature, setLastSignature] = React.useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    if (selected.size) setSelected(new Set());
  }

  // The search box mirrors the URL, so Reset and the back button pull the typed
  // term back into step.
  const [lastSearch, setLastSearch] = React.useState(filters.search);
  if (filters.search !== lastSearch) {
    setLastSearch(filters.search);
    setTerm(filters.search);
  }

  // ------------------------------------------------------------------ url

  const urlFor = (patch: Partial<ProductFilterState>): string => {
    const next: ProductFilterState = { ...filters, ...patch };

    const params = new URLSearchParams();
    if (next.search.trim()) params.set('search', next.search.trim());
    if (next.status !== 'all') params.set('status', next.status);
    if (next.categoryId) params.set('category', next.categoryId);
    if (next.brandId) params.set('brand', next.brandId);
    if (next.stock !== 'all') params.set('stock', next.stock);
    if (next.featured !== 'all') params.set('featured', next.featured);
    if (next.sort !== PRODUCT_DEFAULTS.sort) params.set('sort', next.sort);
    if (next.order !== PRODUCT_DEFAULTS.order) params.set('order', next.order);

    const search = params.toString();
    return search ? `/products?${search}` : '/products';
  };

  const apply = (patch: Partial<ProductFilterState>) => {
    startTransition(() => router.push(urlFor(patch)));
  };

  /** A header click sorts by that column, or flips the direction it is already on. */
  const sortBy = (sort: ProductSort) =>
    apply(
      filters.sort === sort
        ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
        : // Names read A→Z; everything else is more interesting at the top.
          { sort, order: sort === 'name' ? 'asc' : 'desc' },
    );

  const filtering =
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.categoryId !== '' ||
    filters.brandId !== '' ||
    filters.stock !== 'all' ||
    filters.featured !== 'all';

  // --------------------------------------------------------------- writes

  const refresh = () => {
    setSelected(new Set());
    router.refresh();
  };

  /** One write, one message. Used by every row action and the bulk menu. */
  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      toast.success(label);
      refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    api.patch(`/api/v1/admin/products/${id}`, body);

  /**
   * Deleting a product that has sold hides it instead — order lines point at it.
   * The API says which happened, and repeating its own words avoids promising a
   * deletion that did not take place.
   */
  async function removeOne(row: ProductRow) {
    const warning =
      row.soldCount > 0
        ? `\n\nIt has sold ${formatNumber(row.soldCount)} time${row.soldCount === 1 ? '' : 's'}, so it will be hidden from the store rather than deleted.`
        : '';
    if (!globalThis.confirm(`Delete “${row.name}”?${warning}`)) return;

    setBusy(true);
    try {
      const result = await api.delete<{ deleted?: boolean; message?: string } | undefined>(
        `/api/v1/admin/products/${row.id}`,
      );
      toast.success(
        result && result.deleted === false
          ? (result.message ?? 'Product hidden from the store.')
          : 'Product deleted.',
      );
      refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Bulk is a loop over the same endpoints one row uses, not a second write path
   * with its own rules. Failures are counted rather than thrown: one product
   * refusing a price change must not abandon the other nine.
   */
  async function bulk(label: string, work: (id: string) => Promise<unknown>) {
    const ids = [...selected];
    if (!ids.length) return;

    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => work(id)));
    const failed = results.filter((result) => result.status === 'rejected');
    setBusy(false);

    if (failed.length === 0) toast.success(`${label} ${ids.length} product${ids.length === 1 ? '' : 's'}.`);
    else if (failed.length === ids.length) toast.error(errorMessage((failed[0] as PromiseRejectedResult).reason));
    else toast.error(`${ids.length - failed.length} done, ${failed.length} refused — see each row.`);

    refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;

    const chosen = rows.filter((row) => ids.includes(row.id));
    const sold = chosen.filter((row) => row.soldCount > 0).length;
    const note = sold
      ? `\n\n${sold} of them ${sold === 1 ? 'has' : 'have'} sold before, so ${sold === 1 ? 'it' : 'they'} will be hidden from the store rather than deleted.`
      : '';
    if (!globalThis.confirm(`Delete ${ids.length} product${ids.length === 1 ? '' : 's'}?${note}`)) return;

    setBusy(true);
    const results = await Promise.allSettled(
      ids.map((id) => api.delete<{ deleted?: boolean } | undefined>(`/api/v1/admin/products/${id}`)),
    );
    setBusy(false);

    const failed = results.filter((result) => result.status === 'rejected').length;
    const hidden = results.filter(
      (result) => result.status === 'fulfilled' && result.value && result.value.deleted === false,
    ).length;
    const deleted = ids.length - failed - hidden;

    if (failed === ids.length) {
      toast.error(errorMessage((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason));
    } else {
      const parts = [
        deleted ? `${deleted} deleted` : null,
        hidden ? `${hidden} hidden (already sold)` : null,
        failed ? `${failed} refused` : null,
      ].filter(Boolean);
      if (failed) toast.error(parts.join(', '));
      else toast.success(`${parts.join(', ')}.`);
    }

    refresh();
  }

  // --------------------------------------------------------------- export

  /**
   * Exports what the filters select, not what has been scrolled to — a
   * spreadsheet of the twenty-five rows someone happened to stop at is a trap.
   *
   * Read by cursor in batches of 100 (the endpoint's own ceiling) and capped,
   * with the cap reported rather than silently truncating. By cursor rather than
   * by page number because an export of two thousand rows is twenty reads, and
   * the twentieth would otherwise make the database walk past nineteen hundred
   * rows to reach the ones it wants.
   */
  const EXPORT_CAP = 2000;
  const EXPORT_BATCH = 100;

  async function exportCsv() {
    setExporting(true);
    try {
      const collected: ProductRow[] = [];
      let cursor: string | null | undefined;

      while (collected.length < EXPORT_CAP) {
        const batch = await apiFetchListed<ProductRow>('/api/v1/admin/products', {
          query: { ...query, pageSize: EXPORT_BATCH, cursor: cursor ?? undefined },
        });
        collected.push(...batch.data);
        cursor = batch.meta.nextCursor;
        if (!batch.meta.hasMore || !cursor) break;
      }

      const header = [
        'id',
        'name',
        'slug',
        'sku',
        'category',
        'brand',
        'barcode',
        'price',
        'sale_price',
        'cost_price',
        'stock',
        'reserved',
        'incoming',
        'low_stock_threshold',
        'track_inventory',
        'variants',
        'sold',
        'rating',
        'rating_count',
        'status',
        'featured',
        'created_at',
        'updated_at',
      ];
      const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

      const body = collected.map((row) =>
        [
          row.id,
          row.name,
          row.slug,
          row.sku ?? '',
          row.categoryName ?? '',
          row.brandName ?? '',
          row.barcode ?? '',
          row.priceFrom ?? '',
          row.salePriceFrom ?? '',
          row.costPrice ?? '',
          // Blank, not zero: nothing was ever counted for this one, and a zero
          // in a spreadsheet is a number somebody will sum.
          row.stockRecords === 0 ? '' : row.stock,
          row.reserved,
          row.incoming,
          row.lowStockThreshold,
          row.trackInventory ? 'yes' : 'no',
          row.variantCount,
          row.soldCount,
          row.ratingCount === 0 ? '' : row.ratingAverage,
          row.ratingCount,
          row.status,
          row.isFeatured ? 'yes' : 'no',
          row.createdAt,
          row.updatedAt,
        ]
          .map(cell)
          .join(','),
      );

      const blob = new Blob([[header.join(','), ...body].join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'products.csv';
      link.click();
      URL.revokeObjectURL(url);

      if (list.total !== null && list.total > collected.length) {
        toast.error(`Exported the first ${formatNumber(collected.length)} of ${formatNumber(list.total)}.`);
      } else {
        toast.success(`Exported ${formatNumber(collected.length)} product${collected.length === 1 ? '' : 's'}.`);
      }
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  // ----------------------------------------------------------------- view

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = rows.some((row) => selected.has(row.id));

  const categoryOptions = React.useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );
  const brandOptions = React.useMemo(() => [...brands].sort((a, b) => a.name.localeCompare(b.name)), [brands]);

  /*
   * Columns as data, not as JSX. A virtualised table only ever holds the rows on
   * screen, so its columns cannot be sized from its contents — `InfiniteTable`
   * declares them in a `<colgroup>` and lays the table out fixed, and these
   * widths are what it puts there. `Product` carries no width: it is the one
   * column that absorbs whatever is left.
   */
  const columns: Column<ProductRow>[] = [
    {
      key: 'select',
      width: '2.75rem',
      className: 'pr-0',
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={(checked) =>
            setSelected(() => (checked === true ? new Set(rows.map((row) => row.id)) : new Set()))
          }
          aria-label="Select every product loaded"
        />
      ),
      cell: (row) => (
        <Checkbox
          checked={selected.has(row.id)}
          onCheckedChange={(checked) =>
            setSelected((current) => {
              const next = new Set(current);
              if (checked === true) next.add(row.id);
              else next.delete(row.id);
              return next;
            })
          }
          aria-label={`Select ${row.name}`}
        />
      ),
    },
    {
      key: 'name',
      header: (
        <SortButton sort="name" active={filters.sort} order={filters.order} onSort={sortBy}>
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
              <span className={cn('grid size-10 place-items-center rounded-lg', TINTS[tintFor(row.id)])}>
                <Package className="size-4" />
              </span>
            }
          />

          <div className="min-w-0">
            <Link href={`/products/${row.id}`} className="block truncate font-semibold hover:underline">
              {row.name}
            </Link>
            {/*
              The scan codes and the variant count on one line under the name. A
              barcode is what somebody holding the product reads off it, so it
              belongs where they are already looking — but only when there is
              one, because a dash here would be nothing repeated down every row
              of a shop that has never barcoded anything.
            */}
            <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
              <span className="font-mono">{row.sku ?? 'no SKU'}</span>
              {row.barcode ? <span className="truncate font-mono opacity-70">{row.barcode}</span> : null}
              {row.variantCount > 1 ? (
                <span className="inline-flex shrink-0 items-center gap-1">
                  <Layers className="size-3" aria-hidden />
                  {row.variantCount}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      ),
    },
    {
      /*
       * Category and brand share a column rather than taking one each. They
       * answer the same question — where this sits in the catalogue — they are
       * both short, and stacking them buys the width the stock counts and the
       * margin needed. Two narrow columns of truncated text read worse than one.
       */
      key: 'placement',
      width: '9rem',
      header: 'Category',
      cell: (row) => (
        <div className="min-w-0 text-sm">
          <p className="truncate">{row.categoryName ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.brandName ?? 'No brand'}</p>
        </div>
      ),
    },
    {
      key: 'price',
      width: '8rem',
      header: (
        <SortButton sort="price" active={filters.sort} order={filters.order} onSort={sortBy}>
          Price
        </SortButton>
      ),
      cell: (row) => {
        const margin = marginOf(row);
        return (
          <div className="min-w-0">
            <p className="truncate whitespace-nowrap">
              {row.salePriceFrom ? (
                <>
                  <span className="font-medium tabular-nums">{formatMoney(row.salePriceFrom, currency)}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground line-through tabular-nums">
                    {formatMoney(row.priceFrom, currency)}
                  </span>
                </>
              ) : (
                <span className="font-medium tabular-nums">{formatMoney(row.priceFrom, currency)}</span>
              )}
            </p>
            <p
              className={cn(
                'truncate text-xs tabular-nums',
                margin !== null && margin < 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {margin === null ? 'no cost set' : `${margin.toFixed(0)}% margin`}
            </p>
          </div>
        );
      },
    },
    {
      key: 'stock',
      width: '9rem',
      header: (
        <SortButton sort="stock" active={filters.sort} order={filters.order} onSort={sortBy}>
          Stock
        </SortButton>
      ),
      /*
       * The number first, with the badge as its colour rather than as its label.
       * "12" beside an amber chip is read at a glance; "Low · 12" has to be read
       * twice. Reserved and incoming go underneath because they are what decide
       * whether twelve is a problem — twelve with eight spoken for is nearly
       * gone, twelve with forty on the way is not worth reordering.
       */
      cell: (row) => {
        const stock = stockOf(row);
        const held = [
          row.reserved > 0 ? `${formatNumber(row.reserved)} reserved` : null,
          row.incoming > 0 ? `${formatNumber(row.incoming)} incoming` : null,
        ].filter(Boolean);

        return (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5">
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  stock.tone === 'danger' && 'text-destructive',
                  stock.tone === 'warning' && 'text-warning',
                )}
              >
                {row.stockRecords === 0 ? '—' : formatNumber(row.stock)}
              </span>
              <Badge variant={stock.tone}>{stock.label}</Badge>
            </p>
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {held.length > 0 ? held.join(' · ') : `warns at ${formatNumber(row.lowStockThreshold)}`}
            </p>
          </div>
        );
      },
    },
    {
      /*
       * Two lifetime figures answering the same question — is this product
       * working — so they share a column. Sold is the sortable one; the rating
       * rides under it because a good seller with a falling rating is the row an
       * owner most needs to notice, and it is invisible if it only exists on a
       * screen they have to open one product at a time.
       */
      key: 'performance',
      width: '6.5rem',
      header: (
        <SortButton sort="sold" active={filters.sort} order={filters.order} onSort={sortBy}>
          Sold
        </SortButton>
      ),
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium tabular-nums">{formatNumber(row.soldCount)}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground tabular-nums">
            {row.ratingCount > 0 ? (
              <>
                <Star className="size-3 shrink-0 fill-warning text-warning" aria-hidden />
                {Number(row.ratingAverage).toFixed(1)}
                <span className="opacity-70">({formatNumber(row.ratingCount)})</span>
              </>
            ) : (
              'no reviews'
            )}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      width: '9rem',
      header: (
        <span className="inline-flex items-center gap-1.5">
          Status
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="What these badges mean">
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <b>Active</b> — on sale. <b>Draft</b> — never published. <b>Inactive</b> — withdrawn from sale.{' '}
              <b>Featured</b> — promoted on the storefront.
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
          {row.isFeatured ? <Badge variant="warning">Featured</Badge> : null}
          {row.isNewArrival ? <Badge variant="outline">New</Badge> : null}
        </div>
      ),
    },
    {
      /*
       * Relative on top, absolute underneath. "3 days ago" is what tells a reader
       * whether a price is current; the date it was added is what tells them
       * whether it is a new line or an old one nobody has touched — and neither
       * substitutes for the other.
       */
      key: 'updated',
      width: '6.75rem',
      className: 'text-xs text-muted-foreground',
      header: (
        <SortButton sort="updatedAt" active={filters.sort} order={filters.order} onSort={sortBy}>
          Updated
        </SortButton>
      ),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{formatRelative(row.updatedAt)}</p>
          <p className="truncate opacity-70">added {shortDate(row.createdAt)}</p>
        </div>
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
                aria-label={`View ${row.name}`}
                onClick={() => viewing.view(row)}
              >
                <Eye />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View every detail</TooltipContent>
          </Tooltip>

          {storefrontBase ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a
                    href={`${storefrontBase}/product/${row.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${row.name} on the storefront`}
                  >
                    <Store />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open on the storefront</TooltipContent>
            </Tooltip>
          ) : null}

          {permissions.update ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quick edit ${row.name}`}
                  onClick={() => setEditing(row)}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Quick edit</TooltipContent>
            </Tooltip>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${row.name}`}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/products/${row.id}`}>
                  <ArrowUpRight /> Open full editor
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/inventory?search=${encodeURIComponent(row.sku ?? row.name)}`}>
                  <Warehouse /> Adjust stock
                </Link>
              </DropdownMenuItem>

              {permissions.update ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(row.isFeatured ? 'No longer featured.' : 'Featured.', () =>
                        patch(row.id, { isFeatured: !row.isFeatured }),
                      )
                    }
                  >
                    <Star /> {row.isFeatured ? 'Remove from featured' : 'Mark as featured'}
                  </DropdownMenuItem>
                  {row.status === 'active' ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        void run('Hidden from the storefront.', () => patch(row.id, { status: 'inactive' }))
                      }
                    >
                      <EyeOff /> Hide from storefront
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={() => void run('Published.', () => patch(row.id, { status: 'active' }))}
                    >
                      <BadgeCheck /> Publish
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}

              {permissions.delete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void removeOne(row)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PageHeader
          title="Products"
          breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Products' }]}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} loading={exporting} disabled={rows.length === 0}>
                {exporting ? null : <Download />} Export
              </Button>

              {permissions.update || permissions.delete ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={selected.size === 0 || busy}>
                      Bulk Actions
                      {selected.size ? <Badge variant="primary">{selected.size}</Badge> : null}
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{selected.size} selected</DropdownMenuLabel>

                    {permissions.update ? (
                      <>
                        <DropdownMenuItem
                          onSelect={() => bulk('Published', (id) => patch(id, { status: 'active' }))}
                        >
                          <BadgeCheck /> Publish
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => bulk('Moved to draft', (id) => patch(id, { status: 'draft' }))}>
                          <Pencil /> Move to draft
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => bulk('Hidden', (id) => patch(id, { status: 'inactive' }))}
                        >
                          <EyeOff /> Hide from storefront
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => bulk('Featured', (id) => patch(id, { isFeatured: true }))}>
                          <Star /> Mark featured
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => bulk('Unfeatured', (id) => patch(id, { isFeatured: false }))}
                        >
                          <Star /> Remove featured
                        </DropdownMenuItem>
                      </>
                    ) : null}

                    {permissions.delete ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={bulkDelete}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {permissions.create ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Add Product
                </Button>
              ) : null}
            </>
          }
        />

        {/* ---------------------------------------------------------- stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Package}
            tint="primary"
            label="Total Products"
            value={stats?.total ?? list.total ?? rows.length}
            note={
              stats
                ? stats.addedThisMonth > 0
                  ? `+${formatNumber(stats.addedThisMonth)} added this month`
                  : 'None added this month'
                : 'Across the whole catalogue'
            }
            good={(stats?.addedThisMonth ?? 0) > 0}
          />
          <StatCard
            icon={BadgeCheck}
            tint="success"
            label="Active Products"
            value={stats?.active ?? 0}
            note={
              stats
                ? `${formatNumber(stats.draft)} draft · ${formatNumber(stats.inactive)} hidden`
                : 'On sale right now'
            }
          />
          <StatCard
            icon={TriangleAlert}
            tint="warning"
            label="Low Stock"
            value={stats?.lowStock ?? 0}
            note={
              stats && stats.untracked > 0
                ? `${formatNumber(stats.untracked)} with no stock record`
                : 'At or below their reorder point'
            }
          />
          <StatCard
            icon={PackageX}
            tint="danger"
            label="Out of Stock"
            value={stats?.outOfStock ?? 0}
            note="Cannot be bought until restocked"
          />
        </div>

        {/* -------------------------------------------------------- filters */}
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
              placeholder="Search by name, slug or SKU…"
              aria-label="Search products"
              className="pl-9"
            />
          </div>

          <select
            value={filters.categoryId}
            onChange={(event) => apply({ categoryId: event.target.value })}
            aria-label="Category"
            className={cn(SELECT_CLASS, 'lg:w-48')}
          >
            <option value="">All Categories</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            value={filters.brandId}
            onChange={(event) => apply({ brandId: event.target.value })}
            aria-label="Brand"
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="">All Brands</option>
            {brandOptions.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(event) => apply({ status: event.target.value as ProductFilterState['status'] })}
            aria-label="Status"
            className={cn(SELECT_CLASS, 'lg:w-36')}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="inactive">Inactive</option>
          </select>

          <select
            value={filters.stock}
            onChange={(event) => apply({ stock: event.target.value as ProductFilterState['stock'] })}
            aria-label="Stock"
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="all">All Stock</option>
            <option value="in_stock">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            {/* "Not counted", not "Not tracked": the API filters this on having
                no `inventory_levels` row at all, which is a different state from
                an owner switching stock tracking off — and the badge in the
                Stock column now names both. Two labels for two states, or the
                filter selects rows that do not carry the word it used. */}
            <option value="untracked">Not counted</option>
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
                    startTransition(() => router.push('/products'));
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

        {/* ---------------------------------------------------------- table */}
        <InfiniteTable
          columns={columns}
          rows={rows}
          total={list.total}
          noun="product"
          hasMore={list.hasMore}
          loading={list.loading}
          error={list.error}
          onLoadMore={list.loadMore}
          onRetry={list.retry}
          dimmed={pending}
          minWidth="75rem"
          dense
          estimateRowHeight={58}
          empty={
            filtering
              ? "No product matches these filters."
              : "No products yet. Add the first one and it will show up here, ready to publish when you are."
          }
        />

        <ProductCreatePanel
          open={creating}
          onOpenChange={(open) => {
            setCreating(open);
            // `?new=1` has to go with the panel, or a reload — or the next filter
            // change, which rebuilds the URL from `filters` — would reopen it.
            if (!open && openCreate) startTransition(() => router.replace(urlFor({})));
          }}
          categories={categories}
          brands={brands}
          currency={currency}
          storeMeasureOptions={storeMeasureOptions}
          onCreated={(product) => {
            toast.success(`${product.name} created.`, {
              description: 'Specifications, related products and the rest of the gallery are on its own page.',
              action: { label: 'Open', onClick: () => router.push(`/products/${product.id}`) },
            });
            if (openCreate) startTransition(() => router.replace(urlFor({})));
            refresh();
          }}
        />

        <ProductDetail
          row={viewing.row}
          open={viewing.open}
          onOpenChange={viewing.onOpenChange}
          currency={currency}
          storefrontBase={storefrontBase}
        />

        <ProductQuickEdit
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          product={editing}
          categories={categories}
          brands={brands}
          currency={currency}
          onSaved={refresh}
        />
      </div>
    </TooltipProvider>
  );
}
