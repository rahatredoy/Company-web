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
import { useT, type MessageKey } from '@/lib/i18n';
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

const STATUS_LABEL: Record<ProductStatus, MessageKey> = {
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
  /** `pending` keeps only products with a review waiting for a decision. */
  reviews: 'all' | 'pending';
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
  reviews: 'all',
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
    reviews: filters.reviews,
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
  const t = useT();
  const on = active === sort;

  return (
    <button
      type="button"
      onClick={() => onSort(sort)}
      aria-label={t('Sort by {column}', { column: label ?? String(children) })}
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
 * How a product's stock reads, using the same buckets the product screen does.
 *
 * Four states, not three, and they have to stay apart: **not counted** is a
 * variant nobody has ever recorded a level for, **not tracked** is the owner
 * saying stock may never refuse a sale, and both read as zero available while
 * meaning opposite things. Only the third is a shop that has genuinely sold out.
 */
function stockOf(row: ProductRow): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: MessageKey } {
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
function shortDate(input: string, locale: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(locale, {
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
  /** `reviews` decides whether the Reviews column links to the product's Reviews tab. */
  permissions: { create: boolean; update: boolean; delete: boolean; reviews: boolean };
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
  const t = useT();
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
   * buckets, SKUs or the variants that are switched off.
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
    if (next.reviews !== 'all') params.set('reviews', next.reviews);
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
    filters.featured !== 'all' ||
    filters.reviews !== 'all';

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
        ? `\n\n${t.plural(
            row.soldCount,
            'It has sold {count} time, so it will be hidden from the store rather than deleted.',
            'It has sold {count} times, so it will be hidden from the store rather than deleted.',
          )}`
        : '';
    if (!globalThis.confirm(`${t('Delete “{name}”?', { name: row.name })}${warning}`)) return;

    setBusy(true);
    try {
      const result = await api.delete<{ deleted?: boolean; message?: string } | undefined>(
        `/api/v1/admin/products/${row.id}`,
      );
      toast.success(
        result && result.deleted === false
          ? (result.message ?? t('Product hidden from the store.'))
          : t('Product deleted.'),
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
  async function bulk(done: (count: number) => string, work: (id: string) => Promise<unknown>) {
    const ids = [...selected];
    if (!ids.length) return;

    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => work(id)));
    const failed = results.filter((result) => result.status === 'rejected');
    setBusy(false);

    if (failed.length === 0) toast.success(done(ids.length));
    else if (failed.length === ids.length) toast.error(errorMessage((failed[0] as PromiseRejectedResult).reason));
    else
      toast.error(
        t('{done} done, {refused} refused — see each row.', {
          done: ids.length - failed.length,
          refused: failed.length,
        }),
      );

    refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;

    const chosen = rows.filter((row) => ids.includes(row.id));
    const sold = chosen.filter((row) => row.soldCount > 0).length;
    const note = sold
      ? `\n\n${t.plural(
          sold,
          '{count} of them has sold before, so it will be hidden from the store rather than deleted.',
          '{count} of them have sold before, so they will be hidden from the store rather than deleted.',
        )}`
      : '';
    if (!globalThis.confirm(`${t.plural(ids.length, 'Delete {count} product?', 'Delete {count} products?')}${note}`)) {
      return;
    }

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
        deleted ? t('{count} deleted', { count: deleted }) : null,
        hidden ? t('{count} hidden (already sold)', { count: hidden }) : null,
        failed ? t('{count} refused', { count: failed }) : null,
      ].filter(Boolean);
      if (failed) toast.error(parts.join(', '));
      else toast.success(t('{summary}.', { summary: parts.join(', ') }));
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
        toast.error(t('Exported the first {shown} of {total}.', { shown: collected.length, total: list.total }));
      } else {
        toast.success(t.plural(collected.length, 'Exported {count} product.', 'Exported {count} products.'));
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

  /** A whole percentage, in the panel's own digits. */
  const percent = (value: number) => `${t.number(value, { maximumFractionDigits: 0, useGrouping: false })}%`;

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
          aria-label={t('Select every product loaded')}
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
          aria-label={t('Select {name}', { name: row.name })}
        />
      ),
    },
    {
      key: 'name',
      header: (
        <SortButton sort="name" active={filters.sort} order={filters.order} onSort={sortBy}>
          {t('Product')}
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
              <span className="font-mono">{row.sku ?? t('no SKU')}</span>
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
      header: t('Category'),
      cell: (row) => (
        <div className="min-w-0 text-sm">
          <p className="truncate">{row.categoryName ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.brandName ?? t('No brand')}</p>
        </div>
      ),
    },
    {
      key: 'price',
      width: '8rem',
      header: (
        <SortButton sort="price" active={filters.sort} order={filters.order} onSort={sortBy}>
          {t('Price')}
        </SortButton>
      ),
      cell: (row) => {
        const margin = marginOf(row);
        return (
          <div className="min-w-0">
            <p className="truncate whitespace-nowrap">
              {row.salePriceFrom ? (
                <>
                  <span className="font-medium tabular-nums">{t.money(row.salePriceFrom, currency)}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground line-through tabular-nums">
                    {t.money(row.priceFrom, currency)}
                  </span>
                </>
              ) : (
                <span className="font-medium tabular-nums">{t.money(row.priceFrom, currency)}</span>
              )}
            </p>
            <p
              className={cn(
                'truncate text-xs tabular-nums',
                margin !== null && margin < 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {margin === null ? t('no cost set') : t('{percent} margin', { percent: percent(margin) })}
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
          {t('Stock')}
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
          row.reserved > 0 ? t('{count} reserved', { count: row.reserved }) : null,
          row.incoming > 0 ? t('{count} incoming', { count: row.incoming }) : null,
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
                {row.stockRecords === 0 ? '—' : t.number(row.stock)}
              </span>
              <Badge variant={stock.tone}>{t(stock.label)}</Badge>
            </p>
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {held.length > 0 ? held.join(' · ') : t('warns at {count}', { count: row.lowStockThreshold })}
            </p>
          </div>
        );
      },
    },
    {
      key: 'performance',
      width: '5rem',
      header: (
        <SortButton sort="sold" active={filters.sort} order={filters.order} onSort={sortBy}>
          {t('Sold')}
        </SortButton>
      ),
      cell: (row) => <p className="font-medium tabular-nums">{t.number(row.soldCount)}</p>,
    },
    {
      /*
       * Reviews are moderated per product — there is no separate queue screen.
       * The button is the count and opens this product's Reviews tab; under it,
       * whatever is still waiting (or the rating once nothing is), so a product
       * with a review to approve stands out from the list.
       */
      key: 'reviews',
      width: '7rem',
      header: t('Reviews'),
      cell: (row) => {
        const label = (
          <>
            <Star
              className={cn('size-3.5 shrink-0', row.ratingCount > 0 ? 'fill-warning text-warning' : '')}
              aria-hidden
            />
            <span className="tabular-nums">{t.number(row.reviewCount)}</span>
          </>
        );

        return (
          <div className="min-w-0">
            {permissions.reviews ? (
              <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2">
                <Link
                  href={`/products/${row.id}?tab=reviews`}
                  aria-label={t.plural(row.reviewCount, '{count} review', '{count} reviews')}
                >
                  {label}
                </Link>
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm">{label}</span>
            )}
            <p className="mt-0.5 truncate text-xs tabular-nums">
              {row.pendingReviewCount > 0 ? (
                <span className="text-warning">{t('{count} waiting', { count: row.pendingReviewCount })}</span>
              ) : row.ratingCount > 0 ? (
                <span className="text-muted-foreground">
                  {t.number(Number(row.ratingAverage), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
              ) : row.reviewCount === 0 ? (
                <span className="text-muted-foreground">{t('no reviews')}</span>
              ) : null}
            </p>
          </div>
        );
      },
    },
    {
      key: 'status',
      width: '9rem',
      header: (
        <span className="inline-flex items-center gap-1.5">
          {t('Status')}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={t('What these badges mean')}>
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {t.rich(
                '{active} — on sale. {draft} — never published. {inactive} — withdrawn from sale. {featured} — promoted on the storefront.',
                {
                  active: <b>{t('Active')}</b>,
                  draft: <b>{t('Draft')}</b>,
                  inactive: <b>{t('Inactive')}</b>,
                  featured: <b>{t('Featured')}</b>,
                },
              )}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_TONE[row.status]}>{t(STATUS_LABEL[row.status])}</Badge>
          {row.isFeatured ? <Badge variant="warning">{t('Featured')}</Badge> : null}
          {row.isNewArrival ? <Badge variant="outline">{t('New')}</Badge> : null}
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
          {t('Updated')}
        </SortButton>
      ),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{t.relative(row.updatedAt)}</p>
          <p className="truncate opacity-70">{t('added {date}', { date: shortDate(row.createdAt, t.locale) })}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      width: '10rem',
      headClassName: 'text-right',
      header: t('Actions'),
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('View {name}', { name: row.name })}
                onClick={() => viewing.view(row)}
              >
                <Eye />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('View every detail')}</TooltipContent>
          </Tooltip>

          {permissions.update ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Quick edit {name}', { name: row.name })}
                  onClick={() => setEditing(row)}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('Quick edit')}</TooltipContent>
            </Tooltip>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('More actions for {name}', { name: row.name })}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/products/${row.id}`}>
                  <ArrowUpRight /> {t('Open full editor')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/products/${row.id}?stock=adjust`}>
                  <Warehouse /> {t('Adjust stock')}
                </Link>
              </DropdownMenuItem>

              {permissions.update ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(row.isFeatured ? t('No longer featured.') : t('Featured.'), () =>
                        patch(row.id, { isFeatured: !row.isFeatured }),
                      )
                    }
                  >
                    <Star /> {row.isFeatured ? t('Remove from featured') : t('Mark as featured')}
                  </DropdownMenuItem>
                  {row.status === 'active' ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(t('Hidden from the storefront.'), () => patch(row.id, { status: 'inactive' }))
                      }
                    >
                      <EyeOff /> {t('Hide from storefront')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={() => void run(t('Published.'), () => patch(row.id, { status: 'active' }))}
                    >
                      <BadgeCheck /> {t('Publish')}
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}

              {permissions.delete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void removeOne(row)}>
                    <Trash2 /> {t('Delete')}
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
          title={t('Products')}
          breadcrumb={[{ label: t('Dashboard'), href: '/dashboard' }, { label: t('Products') }]}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} loading={exporting} disabled={rows.length === 0}>
                {exporting ? null : <Download />} {t('Export')}
              </Button>

              {permissions.update || permissions.delete ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={selected.size === 0 || busy}>
                      {t('Bulk Actions')}
                      {selected.size ? <Badge variant="primary">{t.number(selected.size)}</Badge> : null}
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t('{count} selected', { count: selected.size })}</DropdownMenuLabel>

                    {permissions.update ? (
                      <>
                        <DropdownMenuItem
                          onSelect={() =>
                            bulk(
                              (count) => t.plural(count, 'Published {count} product.', 'Published {count} products.'),
                              (id) => patch(id, { status: 'active' }),
                            )
                          }
                        >
                          <BadgeCheck /> {t('Publish')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            bulk(
                              (count) =>
                                t.plural(count, 'Moved to draft {count} product.', 'Moved to draft {count} products.'),
                              (id) => patch(id, { status: 'draft' }),
                            )
                          }
                        >
                          <Pencil /> {t('Move to draft')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            bulk(
                              (count) => t.plural(count, 'Hidden {count} product.', 'Hidden {count} products.'),
                              (id) => patch(id, { status: 'inactive' }),
                            )
                          }
                        >
                          <EyeOff /> {t('Hide from storefront')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            bulk(
                              (count) => t.plural(count, 'Featured {count} product.', 'Featured {count} products.'),
                              (id) => patch(id, { isFeatured: true }),
                            )
                          }
                        >
                          <Star /> {t('Mark featured')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            bulk(
                              (count) => t.plural(count, 'Unfeatured {count} product.', 'Unfeatured {count} products.'),
                              (id) => patch(id, { isFeatured: false }),
                            )
                          }
                        >
                          <Star /> {t('Remove featured')}
                        </DropdownMenuItem>
                      </>
                    ) : null}

                    {permissions.delete ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={bulkDelete}>
                          <Trash2 /> {t('Delete')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {permissions.create ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus /> {t('Add Product')}
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
            label={t('Total Products')}
            value={stats?.total ?? list.total ?? rows.length}
            note={
              stats
                ? stats.addedThisMonth > 0
                  ? t('+{count} added this month', { count: stats.addedThisMonth })
                  : t('None added this month')
                : t('Across the whole catalogue')
            }
            good={(stats?.addedThisMonth ?? 0) > 0}
          />
          <StatCard
            icon={BadgeCheck}
            tint="success"
            label={t('Active Products')}
            value={stats?.active ?? 0}
            note={
              stats
                ? t('{draft} draft · {hidden} hidden', { draft: stats.draft, hidden: stats.inactive })
                : t('On sale right now')
            }
          />
          <StatCard
            icon={TriangleAlert}
            tint="warning"
            label={t('Low Stock')}
            value={stats?.lowStock ?? 0}
            note={
              stats && stats.untracked > 0
                ? t('{count} with no stock record', { count: stats.untracked })
                : t('At or below their reorder point')
            }
          />
          <StatCard
            icon={PackageX}
            tint="danger"
            label={t('Out of Stock')}
            value={stats?.outOfStock ?? 0}
            note={t('Cannot be bought until restocked')}
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
              placeholder={t('Search by name, slug or SKU…')}
              aria-label={t('Search products')}
              className="pl-9"
            />
          </div>

          <select
            value={filters.categoryId}
            onChange={(event) => apply({ categoryId: event.target.value })}
            aria-label={t('Category')}
            className={cn(SELECT_CLASS, 'lg:w-48')}
          >
            <option value="">{t('All Categories')}</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            value={filters.brandId}
            onChange={(event) => apply({ brandId: event.target.value })}
            aria-label={t('Brand')}
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="">{t('All Brands')}</option>
            {brandOptions.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(event) => apply({ status: event.target.value as ProductFilterState['status'] })}
            aria-label={t('Status')}
            className={cn(SELECT_CLASS, 'lg:w-36')}
          >
            <option value="all">{t('All Status')}</option>
            <option value="active">{t('Active')}</option>
            <option value="draft">{t('Draft')}</option>
            <option value="inactive">{t('Inactive')}</option>
          </select>

          <select
            value={filters.stock}
            onChange={(event) => apply({ stock: event.target.value as ProductFilterState['stock'] })}
            aria-label={t('Stock')}
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="all">{t('All Stock')}</option>
            <option value="in_stock">{t('In stock')}</option>
            <option value="low">{t('Low stock')}</option>
            <option value="out">{t('Out of stock')}</option>
            {/* "Not counted", not "Not tracked": the API filters this on having
                no `inventory_levels` row at all, which is a different state from
                an owner switching stock tracking off — and the badge in the
                Stock column now names both. Two labels for two states, or the
                filter selects rows that do not carry the word it used. */}
            <option value="untracked">{t('Not counted')}</option>
          </select>

          <select
            value={filters.reviews}
            onChange={(event) => apply({ reviews: event.target.value as ProductFilterState['reviews'] })}
            aria-label={t('Reviews')}
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="all">{t('All reviews')}</option>
            <option value="pending">{t('Reviews waiting')}</option>
          </select>

          <div className="flex items-center gap-2 lg:ml-auto">
            <Button type="submit" variant="outline">
              <SlidersHorizontal /> {t('Filter')}
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
                  aria-label={t('Reset filters')}
                >
                  <RotateCcw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('Reset filters')}</TooltipContent>
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
              ? t('No product matches these filters.')
              : t('No products yet. Add the first one and it will show up here, ready to publish when you are.')
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
            toast.success(t('{name} created.', { name: product.name }), {
              description: t('Specifications, related products and the rest of the gallery are on its own page.'),
              action: { label: t('Open'), onClick: () => router.push(`/products/${product.id}`) },
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
          canEdit={permissions.update}
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
