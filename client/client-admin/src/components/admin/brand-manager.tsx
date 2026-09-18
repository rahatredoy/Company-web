'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  Download,
  Eye,
  EyeOff,
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
import { useT } from '@/lib/i18n';
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
 * here. That is what makes "select all" mean every brand the filter kept.
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
  const t = useT();

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
   * It needs no fetch: this screen already holds every column of every brand.
   * The storefront moved to `Store` beside it.
   */
  const viewing = useViewTarget<BrandRow>();

  // ---------------------------------------------------------------- derived

  /** The storefront's own order: by name. */
  const ordered = React.useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
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
        ? `\n\n${t.plural(
            row.productCount,
            '{count} product will stay, without a brand.',
            '{count} products will stay, without a brand.',
          )}`
        : '';
    if (!globalThis.confirm(`${t('Delete “{name}”?', { name: row.name })}${warning}`)) return;
    await run(t('Brand deleted.'), () => api.delete(`/api/v1/admin/brands/${row.id}`));
  }

  /**
   * Bulk is a loop over the same endpoints one row uses, not a second write path
   * with its own rules. Failures are counted rather than thrown: one refusal must
   * not abandon the other nine.
   */
  async function bulk(success: (count: number) => string, work: (id: string) => Promise<unknown>) {
    const ids = [...selected];
    if (!ids.length) return;

    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => work(id)));
    const failed = results.filter((result) => result.status === 'rejected');
    setBusy(false);

    if (failed.length === 0) toast.success(success(ids.length));
    else if (failed.length === ids.length) toast.error(errorMessage((failed[0] as PromiseRejectedResult).reason));
    else
      toast.error(
        t('{done} done, {failed} refused — see each row.', {
          done: ids.length - failed.length,
          failed: failed.length,
        }),
      );

    refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;

    const attached = rows.filter((row) => ids.includes(row.id)).reduce((sum, row) => sum + row.productCount, 0);
    const note = attached
      ? `\n\n${t.plural(attached, '{count} product will stay, without a brand.', '{count} products will stay, without a brand.')}`
      : '';
    if (!globalThis.confirm(`${t.plural(ids.length, 'Delete {count} brand?', 'Delete {count} brands?')}${note}`)) return;

    await bulk(
      (count) => t.plural(count, 'Deleted {count} brand.', 'Deleted {count} brands.'),
      (id) => api.delete(`/api/v1/admin/brands/${id}`),
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
          aria-label={t('Select every brand the filters kept')}
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
      key: 'brand',
      header: t('Brand'),
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
      key: 'products',
      width: '7rem',
      headClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      header: t('Products'),
      cell: (row) => t.number(row.productCount),
    },
    {
      key: 'status',
      width: '12rem',
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
                '{visible} — shoppers can browse it. {featured} — it leads the storefront’s brand strip. A hidden brand keeps its products; they just stop naming it.',
                {
                  visible: <b>{t('Visible')}</b>,
                  featured: <b>{t('Featured')}</b>,
                },
              )}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.isFeatured ? <Badge variant="warning">{t('Featured')}</Badge> : null}
          <Badge variant={row.isActive ? 'success' : 'neutral'}>{row.isActive ? t('Visible') : t('Hidden')}</Badge>
        </div>
      ),
    },
    {
      key: 'actions',
      width: '11rem',
      headClassName: 'text-right',
      header: t('Actions'),
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('View {name}', { name: row.name })}
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
                aria-label={t('Open {name} on the storefront', { name: row.name })}
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
                aria-label={t('Edit {name}', { name: row.name })}
                onClick={() => setPanel({ open: true, row })}
              >
                <Pencil />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('More actions for {name}', { name: row.name })}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(row.isFeatured ? t('No longer featured.') : t('Featured.'), () =>
                        patch(row.id, { isFeatured: !row.isFeatured }),
                      )
                    }
                  >
                    <Star /> {row.isFeatured ? t('Remove from featured') : t('Mark as featured')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(row.isActive ? t('Hidden.') : t('Visible.'), () =>
                        patch(row.id, { isActive: !row.isActive }),
                      )
                    }
                  >
                    {row.isActive ? <EyeOff /> : <Eye />}
                    {row.isActive ? t('Hide from storefront') : t('Show on storefront')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void removeOne(row)}>
                    <Trash2 /> {t('Delete')}
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
          title={t('Brands')}
          breadcrumb={[{ label: t('Dashboard'), href: '/dashboard' }, { label: t('Brands') }]}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} disabled={visible.length === 0}>
                <Download /> {t('Export')}
              </Button>

              {canManage ? (
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
                    <DropdownMenuItem
                      onSelect={() =>
                        bulk(
                          (count) => t.plural(count, 'Made visible {count} brand.', 'Made visible {count} brands.'),
                          (id) => patch(id, { isActive: true }),
                        )
                      }
                    >
                      <Eye /> {t('Make visible')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        bulk(
                          (count) => t.plural(count, 'Hidden {count} brand.', 'Hidden {count} brands.'),
                          (id) => patch(id, { isActive: false }),
                        )
                      }
                    >
                      <EyeOff /> {t('Hide')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        bulk(
                          (count) => t.plural(count, 'Featured {count} brand.', 'Featured {count} brands.'),
                          (id) => patch(id, { isFeatured: true }),
                        )
                      }
                    >
                      <Star /> {t('Mark featured')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        bulk(
                          (count) => t.plural(count, 'Unfeatured {count} brand.', 'Unfeatured {count} brands.'),
                          (id) => patch(id, { isFeatured: false }),
                        )
                      }
                    >
                      <Star /> {t('Remove featured')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={bulkDelete}>
                      <Trash2 /> {t('Delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {canManage ? (
                <Button onClick={() => setPanel({ open: true, row: null })}>
                  <Plus /> {t('Add Brand')}
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
            label={t('Total Brands')}
            value={stats.total}
            note={
              stats.addedThisMonth > 0
                ? t('+{count} added this month', { count: stats.addedThisMonth })
                : t('None added this month')
            }
            good={stats.addedThisMonth > 0}
          />
          <StatCard
            icon={Package}
            tint="success"
            label={t('Branded Products')}
            value={stats.products}
            note={t('Products naming one of these')}
          />
          <StatCard
            icon={Star}
            tint="warning"
            label={t('Featured Brands')}
            value={stats.featured}
            note={t('Promoted on the storefront')}
          />
          <StatCard
            icon={Link2Off}
            tint="danger"
            label={t('Unused Brands')}
            value={stats.unused}
            note={
              stats.hidden > 0
                ? t('{count} hidden from shoppers', { count: stats.hidden })
                : t('No products name them yet')
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
              placeholder={t('Search brands…')}
              aria-label={t('Search brands')}
              className="pl-9"
            />
          </div>

          <select
            value={filters.status}
            onChange={(event) => change('status', event.target.value as BrandFilterState['status'])}
            aria-label={t('Status')}
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="all">{t('All Status')}</option>
            <option value="active">{t('Active')}</option>
            <option value="inactive">{t('Hidden')}</option>
          </select>

          <select
            value={filters.featured}
            onChange={(event) => change('featured', event.target.value as BrandFilterState['featured'])}
            aria-label={t('Featured')}
            className={cn(SELECT_CLASS, 'lg:w-44')}
          >
            <option value="all">{t('All Brands')}</option>
            <option value="yes">{t('Featured only')}</option>
            <option value="no">{t('Not featured')}</option>
          </select>

          <select
            value={filters.usage}
            onChange={(event) => change('usage', event.target.value as BrandFilterState['usage'])}
            aria-label={t('Products')}
            className={cn(SELECT_CLASS, 'lg:w-44')}
          >
            <option value="all">{t('Used or not')}</option>
            <option value="used">{t('With products')}</option>
            <option value="unused">{t('Without products')}</option>
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
                    setFilters({ search: '', status: 'all', featured: 'all', usage: 'all' });
                    setTerm('');
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
          rows={visible}
          total={visible.length}
          noun="brand"
          /*
           * Nothing to fetch: the whole set arrived with the page. This is here
           * for the virtualisation and for one consistent table.
           */
          hasMore={false}
          loading={false}
          error={null}
          onLoadMore={() => {}}
          onRetry={() => {}}
          minWidth="54rem"
          estimateRowHeight={65}
          empty={
            rows.length === 0
              ? t('No brands yet. Add one to label who makes what you sell.')
              : t('No brand matches these filters.')
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
