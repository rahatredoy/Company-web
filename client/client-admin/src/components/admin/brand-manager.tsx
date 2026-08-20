'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Info,
  Link2Off,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Store,
  Tags,
  Trash2,
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
import { api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BrandRow } from '@/lib/types';
import { useViewTarget } from '@/hooks/use-detail';
import { InfiniteTable, type Column } from './infinite-table';
import { LazyImage } from './lazy-image';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { BrandPanel } from './brand-panel';
import { BrandDetail } from './brand-detail';
import { SELECT_CLASS, tintFor } from './category-tree';

/**
 * The brand screen: the list, what it says about itself, and every write that can
 * be made from it.
 *
 * Brands are flat and few — a shop has dozens, not thousands — so the page reads
 * the whole set once and the counts, the filters and the ordering are all derived
 * here. That is what makes "select all" mean every brand the filter kept, and
 * what lets a drag reorder renumber the real list rather than a page of it.
 *
 * There is therefore nothing to fetch as the reader scrolls — the list is
 * already in hand — but it is still rendered through `InfiniteTable`, which
 * keeps only the visible rows in the DOM. A shop that has outgrown "dozens" gets
 * one scrolling list rather than a pager, and the same table as every other
 * screen in the panel.
 *
 * Filters live in React state and are mirrored into the address bar with
 * `history.replaceState` rather than a router push: the data is already here, so
 * a navigation would refetch it to show something already on screen.
 */

const TINTS = [
  'bg-primary-soft text-accent-foreground',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-destructive-soft text-destructive',
  'bg-accent text-accent-foreground',
] as const;

export interface BrandFilterState {
  search: string;
  status: 'all' | 'active' | 'inactive';
  featured: 'all' | 'yes' | 'no';
  usage: 'all' | 'used' | 'unused';
}

export function BrandManager({
  rows,
  canManage,
  storefrontBase,
  monthStart,
  initial,
}: {
  rows: BrandRow[];
  canManage: boolean;
  /** Storefront origin, for the preview link. Null on a host we cannot read. */
  storefrontBase: string | null;
  /** Start of the current month, resolved on the server so both renders agree. */
  monthStart: string;
  initial: BrandFilterState;
}) {
  const router = useRouter();

  const [filters, setFilters] = React.useState({
    search: initial.search,
    status: initial.status,
    featured: initial.featured,
    usage: initial.usage,
  });
  const [term, setTerm] = React.useState(initial.search);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const [panel, setPanel] = React.useState<{ open: boolean; row: BrandRow | null }>({ open: false, row: null });
  /*
   * The read-only panel `Eye` opens, which used to be the storefront.
   *
   * It needs no fetch: this screen already holds every column of every brand,
   * because a drag reorder renumbers the real list and the set is read whole.
   * The storefront moved to `Store` beside it.
   */
  const viewing = useViewTarget<BrandRow>();

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropId, setDropId] = React.useState<string | null>(null);

  // ---------------------------------------------------------------- derived

  /** The storefront's own order: `sort_order`, then name. */
  const ordered = React.useMemo(
    () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [rows],
  );

  const visible = React.useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return ordered.filter((row) => {
      if (needle && !row.name.toLowerCase().includes(needle) && !row.slug.toLowerCase().includes(needle)) {
        return false;
      }
      if (filters.status !== 'all' && row.isActive !== (filters.status === 'active')) return false;
      if (filters.featured !== 'all' && row.isFeatured !== (filters.featured === 'yes')) return false;
      if (filters.usage === 'used' && row.productCount === 0) return false;
      if (filters.usage === 'unused' && row.productCount > 0) return false;
      return true;
    });
  }, [ordered, filters]);

  const filtering =
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.featured !== 'all' ||
    filters.usage !== 'all';

  const stats = React.useMemo(() => {
    const since = new Date(monthStart).getTime();
    return {
      total: rows.length,
      addedThisMonth: rows.filter((row) => new Date(row.createdAt).getTime() >= since).length,
      featured: rows.filter((row) => row.isFeatured).length,
      hidden: rows.filter((row) => !row.isActive).length,
      unused: rows.filter((row) => row.productCount === 0).length,
      products: rows.reduce((sum, row) => sum + row.productCount, 0),
    };
  }, [rows, monthStart]);

  const allSelected = visible.length > 0 && visible.every((row) => selected.has(row.id));
  const someSelected = visible.some((row) => selected.has(row.id));

  // ------------------------------------------------------------------- url

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.featured !== 'all') params.set('featured', filters.featured);
    if (filters.usage !== 'all') params.set('usage', filters.usage);

    const query = params.toString();
    globalThis.history.replaceState(null, '', query ? `?${query}` : globalThis.location.pathname);
  }, [filters]);

  // ---------------------------------------------------------------- writes

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

  const patch = (id: string, body: Record<string, unknown>) => api.patch(`/api/v1/admin/brands/${id}`, body);

  async function removeOne(row: BrandRow) {
    // The products stay — `products.brand_id` is ON DELETE SET NULL — so the
    // confirmation says so rather than letting someone assume the worst.
    const warning =
      row.productCount > 0
        ? `\n\n${formatNumber(row.productCount)} product${row.productCount === 1 ? '' : 's'} will stay, without a brand.`
        : '';
    if (!globalThis.confirm(`Delete “${row.name}”?${warning}`)) return;
    await run('Brand deleted.', () => api.delete(`/api/v1/admin/brands/${row.id}`));
  }

  /**
   * Bulk is a loop over the same endpoints one row uses, not a second write path
   * with its own rules. Failures are counted rather than thrown: one refusal must
   * not abandon the other nine.
   */
  async function bulk(label: string, work: (id: string) => Promise<unknown>) {
    const ids = [...selected];
    if (!ids.length) return;

    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => work(id)));
    const failed = results.filter((result) => result.status === 'rejected');
    setBusy(false);

    if (failed.length === 0) toast.success(`${label} ${ids.length} brand${ids.length === 1 ? '' : 's'}.`);
    else if (failed.length === ids.length) toast.error(errorMessage((failed[0] as PromiseRejectedResult).reason));
    else toast.error(`${ids.length - failed.length} done, ${failed.length} refused — see each row.`);

    refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;

    const attached = rows.filter((row) => ids.includes(row.id)).reduce((sum, row) => sum + row.productCount, 0);
    const note = attached
      ? `\n\n${formatNumber(attached)} product${attached === 1 ? '' : 's'} will stay, without a brand.`
      : '';
    if (!globalThis.confirm(`Delete ${ids.length} brand${ids.length === 1 ? '' : 's'}?${note}`)) return;

    await bulk('Deleted', (id) => api.delete(`/api/v1/admin/brands/${id}`));
  }

  // -------------------------------------------------------------- reorder

  /**
   * Dropping a row renumbers the whole list, because brands are flat: there is no
   * parent to stay inside, so every brand is every other brand's sibling. Only
   * offered while nothing is filtered — a drop in a filtered view would move a row
   * past neighbours that are not on screen.
   */
  async function onDrop(target: BrandRow) {
    const sourceId = dragId;
    setDragId(null);
    setDropId(null);
    if (!sourceId || sourceId === target.id) return;

    const ids = ordered.map((row) => row.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(target.id);
    if (from < 0 || to < 0) return;

    ids.splice(to, 0, ids.splice(from, 1)[0]!);

    await run('Order saved.', () =>
      api.patch('/api/v1/admin/brands/reorder', {
        order: ids.map((id, index) => ({ id, sortOrder: index })),
      }),
    );
  }

  // --------------------------------------------------------------- export

  function exportCsv() {
    const header = [
      'id',
      'name',
      'slug',
      'products',
      'status',
      'featured',
      'sort_order',
      'website',
      'seo_title',
      'meta_description',
      'created_at',
    ];
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    const body = visible.map((row) =>
      [
        row.id,
        row.name,
        row.slug,
        row.productCount,
        row.isActive ? 'active' : 'hidden',
        row.isFeatured ? 'yes' : 'no',
        row.sortOrder,
        row.websiteUrl ?? '',
        row.seoTitle ?? '',
        row.seoDescription ?? '',
        row.createdAt,
      ]
        .map(cell)
        .join(','),
    );

    const blob = new Blob([[header.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'brands.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // ----------------------------------------------------------------- view

  const change = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  /*
   * Columns as data. A virtualised table only ever holds the rows on screen, so
   * it cannot size its columns from its contents — `InfiniteTable` declares them
   * in a `<colgroup>` and lays the table out fixed. `Brand` carries no width: it
   * is the column that absorbs whatever is left.
   */
  const columns: Column<BrandRow>[] = [
    {
      key: 'grip',
      width: '2.75rem',
      className: 'pr-0',
      header: '',
      cell: (row) =>
        canManage && !filtering ? (
          <span
            draggable
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => {
              setDragId(null);
              setDropId(null);
            }}
            role="button"
            tabIndex={-1}
            aria-label={`Reorder ${row.name}`}
            title="Drag to reorder"
            className="grid size-6 cursor-grab place-items-center text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </span>
        ) : (
          <span className="grid size-6 place-items-center text-border-strong" aria-hidden>
            <GripVertical className="size-4" />
          </span>
        ),
    },
    {
      key: 'select',
      width: '2.75rem',
      className: 'pr-0',
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={(checked) =>
            setSelected((current) => {
              const next = new Set(current);
              for (const row of visible) {
                if (checked === true) next.add(row.id);
                else next.delete(row.id);
              }
              return next;
            })
          }
          aria-label="Select every brand the filters kept"
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
      key: 'brand',
      header: 'Brand',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <LazyImage
            src={row.logoUrl}
            alt=""
            className="size-10 rounded-lg border border-border bg-background"
            fallback={
              <span className={cn('grid size-10 place-items-center rounded-lg', TINTS[tintFor(row.id)])}>
                <Tags className="size-4" />
              </span>
            }
          />

          <div className="min-w-0">
            <p className="truncate font-semibold">{row.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">/{row.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'website',
      width: '15rem',
      className: 'text-sm text-muted-foreground',
      header: 'Website',
      cell: (row) =>
        row.websiteUrl ? (
          <a
            href={row.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 hover:text-foreground hover:underline"
          >
            <span className="truncate">{row.websiteUrl.replace(/^https?:\/\//, '')}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        ) : (
          '\u2014'
        ),
    },
    {
      key: 'products',
      width: '7rem',
      headClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      header: 'Products',
      cell: (row) => formatNumber(row.productCount),
    },
    {
      key: 'status',
      width: '12rem',
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
              <b>Visible</b> — shoppers can browse it. <b>Featured</b> — it leads the storefront’s brand strip.
              A hidden brand keeps its products; they just stop naming it.
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.isFeatured ? <Badge variant="warning">Featured</Badge> : null}
          <Badge variant={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Visible' : 'Hidden'}</Badge>
        </div>
      ),
    },
    {
      key: 'actions',
      width: '11rem',
      headClassName: 'text-right',
      header: 'Actions',
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`View ${row.name}`}
            onClick={() => viewing.view(row)}
          >
            <Eye />
          </Button>

          {storefrontBase ? (
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={`${storefrontBase}/brand/${row.slug}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${row.name} on the storefront`}
              >
                <Store />
              </a>
            </Button>
          ) : null}

          {canManage ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${row.name}`}
                onClick={() => setPanel({ open: true, row })}
              >
                <Pencil />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${row.name}`}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(row.isFeatured ? 'No longer featured.' : 'Featured.', () =>
                        patch(row.id, { isFeatured: !row.isFeatured }),
                      )
                    }
                  >
                    <Star /> {row.isFeatured ? 'Remove from featured' : 'Mark as featured'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(row.isActive ? 'Hidden.' : 'Visible.', () =>
                        patch(row.id, { isActive: !row.isActive }),
                      )
                    }
                  >
                    {row.isActive ? <EyeOff /> : <Eye />}
                    {row.isActive ? 'Hide from storefront' : 'Show on storefront'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void removeOne(row)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PageHeader
          title="Brands"
          breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Brands' }]}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} disabled={visible.length === 0}>
                <Download /> Export
              </Button>

              {canManage ? (
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
                    <DropdownMenuItem onSelect={() => bulk('Made visible', (id) => patch(id, { isActive: true }))}>
                      <Eye /> Make visible
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => bulk('Hidden', (id) => patch(id, { isActive: false }))}>
                      <EyeOff /> Hide
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => bulk('Featured', (id) => patch(id, { isFeatured: true }))}>
                      <Star /> Mark featured
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => bulk('Unfeatured', (id) => patch(id, { isFeatured: false }))}>
                      <Star /> Remove featured
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={bulkDelete}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {canManage ? (
                <Button onClick={() => setPanel({ open: true, row: null })}>
                  <Plus /> Add Brand
                </Button>
              ) : null}
            </>
          }
        />

        {/* ---------------------------------------------------------- stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Tags}
            tint="primary"
            label="Total Brands"
            value={stats.total}
            note={
              stats.addedThisMonth > 0
                ? `+${formatNumber(stats.addedThisMonth)} added this month`
                : 'None added this month'
            }
            good={stats.addedThisMonth > 0}
          />
          <StatCard
            icon={Package}
            tint="success"
            label="Branded Products"
            value={stats.products}
            note="Products naming one of these"
          />
          <StatCard
            icon={Star}
            tint="warning"
            label="Featured Brands"
            value={stats.featured}
            note="Promoted on the storefront"
          />
          <StatCard
            icon={Link2Off}
            tint="danger"
            label="Unused Brands"
            value={stats.unused}
            note={
              stats.hidden > 0
                ? `${formatNumber(stats.hidden)} hidden from shoppers`
                : 'No products name them yet'
            }
          />
        </div>

        {/* -------------------------------------------------------- filters */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFilters((current) => ({ ...current, search: term }));
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
              placeholder="Search brands…"
              aria-label="Search brands"
              className="pl-9"
            />
          </div>

          <select
            value={filters.status}
            onChange={(event) => change('status', event.target.value as BrandFilterState['status'])}
            aria-label="Status"
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Hidden</option>
          </select>

          <select
            value={filters.featured}
            onChange={(event) => change('featured', event.target.value as BrandFilterState['featured'])}
            aria-label="Featured"
            className={cn(SELECT_CLASS, 'lg:w-44')}
          >
            <option value="all">All Brands</option>
            <option value="yes">Featured only</option>
            <option value="no">Not featured</option>
          </select>

          <select
            value={filters.usage}
            onChange={(event) => change('usage', event.target.value as BrandFilterState['usage'])}
            aria-label="Products"
            className={cn(SELECT_CLASS, 'lg:w-44')}
          >
            <option value="all">Used or not</option>
            <option value="used">With products</option>
            <option value="unused">Without products</option>
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
                    setFilters({ search: '', status: 'all', featured: 'all', usage: 'all' });
                    setTerm('');
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
          rows={visible}
          total={visible.length}
          noun="brand"
          /*
           * Nothing to fetch: the whole set arrived with the page, because a drag
           * reorder has to renumber the real list rather than a slice of it. This
           * is here for the virtualisation and for one consistent table.
           */
          hasMore={false}
          loading={false}
          error={null}
          onLoadMore={() => {}}
          onRetry={() => {}}
          minWidth="72rem"
          estimateRowHeight={65}
          rowProps={(row) => ({
            onDragOver: (event) => {
              if (!dragId) return;
              event.preventDefault();
              setDropId(row.id);
            },
            onDragLeave: () => setDropId((current) => (current === row.id ? null : current)),
            onDrop: (event) => {
              event.preventDefault();
              void onDrop(row);
            },
          })}
          rowClassName={(row) =>
            cn(dropId === row.id && dragId !== row.id && 'bg-primary-soft/60', dragId === row.id && 'opacity-50')
          }
          empty={
            rows.length === 0
              ? 'No brands yet. Add one to label who makes what you sell.'
              : 'No brand matches these filters.'
          }
        />

        <BrandDetail
          row={viewing.row}
          open={viewing.open}
          onOpenChange={viewing.onOpenChange}
          storefrontBase={storefrontBase}
        />

        <BrandPanel
          open={panel.open}
          onOpenChange={(open) => setPanel((current) => ({ ...current, open }))}
          brand={panel.row}
          onSaved={refresh}
        />
      </div>
    </TooltipProvider>
  );
}
