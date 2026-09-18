'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Download,
  Eye,
  EyeOff,
  FolderTree,
  GripVertical,
  Info,
  Layers,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Store,
  Tag,
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
import type { CategoryRow } from '@/lib/types';
import { useViewTarget } from '@/hooks/use-detail';
import { InfiniteTable, type Column } from './infinite-table';
import { LazyImage } from './lazy-image';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { CategoryPanel } from './category-panel';
import { CategoryDetail } from './category-detail';
import {
  buildTree,
  filterTree,
  flatten,
  idsIn,
  SELECT_CLASS,
  subtreeFor,
  tintFor,
  type CategoryNode,
  type TreeFilters,
} from './category-tree';

/**
 * The category screen: the tree, what it says about itself, and every write that
 * can be made from it.
 *
 * One client component rather than a page of server-filtered slices, because a
 * tree cannot be paginated server-side without cutting families in half, and
 * because every control here needs the whole set to answer: the counts are over
 * all categories, "select all" means every row the filter kept, and a search for
 * a subcategory has to keep the parent that leads to it. The page reads the
 * whole list once — dozens of rows — and this derives the rest.
 *
 * Filters live in React state and are mirrored into the address bar with
 * `history.replaceState` rather than a router push: the data is already here, so
 * a navigation would refetch it to show something already on screen. The URL
 * stays shareable either way.
 */

const TINTS = [
  'bg-primary-soft text-accent-foreground',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-destructive-soft text-destructive',
  'bg-accent text-accent-foreground',
] as const;

export type CategoryFilterState = TreeFilters;

export function CategoryManager({
  rows,
  canManage,
  storefrontBase,
  monthStart,
  initial,
}: {
  rows: CategoryRow[];
  canManage: boolean;
  /** Storefront origin, for the preview link. Null on a host we cannot read. */
  storefrontBase: string | null;
  /** Start of the current month, resolved on the server so both renders agree. */
  monthStart: string;
  initial: CategoryFilterState;
}) {
  const router = useRouter();
  const t = useT();

  const [filters, setFilters] = React.useState<TreeFilters>({
    search: initial.search,
    status: initial.status,
    visibility: initial.visibility,
    parent: initial.parent,
  });
  const [term, setTerm] = React.useState(initial.search);

  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(rows.filter((row) => row.parentId).map((row) => row.parentId!)),
  );
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  /*
   * The read-only panel `Eye` opens, which used to be the storefront.
   *
   * Nothing is fetched for it: the whole tree arrives with the page, so a node
   * already carries every column plus its product tally. The parent and the
   * child count are handed to the panel from the tree for the same reason — the
   * screen is the only thing that knows what a `parent_id` points at.
   */
  const viewing = useViewTarget<CategoryNode>();

  const [panel, setPanel] = React.useState<{
    open: boolean;
    row: CategoryRow | null;
    parentId: string | null;
    /** Opened as "Add Subcategory": the panel then insists on a parent. */
    sub: boolean;
  }>({
    open: false,
    row: null,
    parentId: null,
    sub: false,
  });

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropId, setDropId] = React.useState<string | null>(null);

  // ---------------------------------------------------------------- derived

  const tree = React.useMemo(() => buildTree(rows), [rows]);

  const visible = React.useMemo(
    () => filterTree(subtreeFor(tree, filters.parent), filters),
    [tree, filters],
  );

  /*
   * The tree, flattened to the rows actually on show — a collapsed parent
   * contributes one row, an expanded one contributes its open descendants too.
   *
   * This is what makes the tree virtualisable at all: a virtualiser needs a flat
   * list it can index into, and rendering each root with its subtree nested
   * inside it would give it a list of roots whose heights it could not know.
   */
  const flat = React.useMemo(() => flatten(visible, expanded), [visible, expanded]);

  const filtering =
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.visibility !== 'all' ||
    filters.parent !== 'all';

  const stats = React.useMemo(() => {
    const since = new Date(monthStart).getTime();
    const parents = new Set(rows.map((row) => row.parentId).filter(Boolean));
    return {
      total: rows.length,
      addedThisMonth: rows.filter((row) => new Date(row.createdAt).getTime() >= since).length,
      subcategories: rows.filter((row) => row.parentId).length,
      parents: parents.size,
      featured: rows.filter((row) => row.isFeatured).length,
      hidden: rows.filter((row) => !row.isActive).length,
    };
  }, [rows, monthStart]);

  // Every id in the filtered tree, not just the rows expanded into view: ticking
  // the header box means "all of these", and a collapsed subtree is still one of
  // them — which is what the bulk actions then act on.
  const allIds = React.useMemo(() => idsIn(visible), [visible]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));

  // ------------------------------------------------------------------- url

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.visibility !== 'all') params.set('visibility', filters.visibility);
    if (filters.parent !== 'all') params.set('parent', filters.parent);

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

  async function patch(id: string, body: Record<string, unknown>) {
    await api.patch(`/api/v1/admin/categories/${id}`, body);
  }

  async function removeOne(row: CategoryRow) {
    const warning =
      row.productCount > 0
        ? `\n\n${t.plural(
            row.productCount,
            '{count} product will stay, without a category.',
            '{count} products will stay, without a category.',
          )}`
        : '';
    if (!globalThis.confirm(`${t('Delete “{name}”?', { name: row.name })}${warning}`)) return;
    await run(t('Category deleted.'), () => api.delete(`/api/v1/admin/categories/${row.id}`));
  }

  /**
   * Bulk is a loop over the same endpoints a single row uses, not a second write
   * path with its own rules. Failures are counted rather than thrown: one
   * category refusing to be deleted because it still has subcategories must not
   * abandon the other nine.
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
    if (
      !globalThis.confirm(
        t.plural(
          ids.length,
          'Delete {count} category? Their products stay, without a category.',
          'Delete {count} categories? Their products stay, without a category.',
        ),
      )
    ) {
      return;
    }
    await bulk(
      (count) => t.plural(count, 'Deleted {count} category.', 'Deleted {count} categories.'),
      (id) => api.delete(`/api/v1/admin/categories/${id}`),
    );
  }

  // -------------------------------------------------------------- reorder

  /**
   * Dropping a row renumbers only its own siblings. Moving a category to a new
   * parent is a decision with consequences — the storefront URL of everything
   * beneath it changes — so that stays in the panel, where it can be seen and
   * confirmed, rather than being one mis-aimed drop away.
   */
  async function onDrop(target: CategoryNode) {
    const sourceId = dragId;
    setDragId(null);
    setDropId(null);
    if (!sourceId || sourceId === target.id) return;

    const source = rows.find((row) => row.id === sourceId);
    if (!source || source.parentId !== target.parentId) {
      toast.error(t('Drag a category above or below one of its own siblings.'));
      return;
    }

    const siblings = rows
      .filter((row) => row.parentId === target.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((row) => row.id);

    const from = siblings.indexOf(sourceId);
    const to = siblings.indexOf(target.id);
    if (from < 0 || to < 0) return;

    siblings.splice(to, 0, siblings.splice(from, 1)[0]!);

    await run(t('Order saved.'), () =>
      api.patch('/api/v1/admin/categories/reorder', {
        order: siblings.map((id, index) => ({ id, sortOrder: index })),
      }),
    );
  }

  // --------------------------------------------------------------- export

  function exportCsv() {
    const header = [
      'id',
      'name',
      'slug',
      'parent',
      'products',
      'status',
      'in_navigation',
      'featured',
      'sort_order',
      'seo_title',
      'meta_description',
      'created_at',
    ];
    const nameById = new Map(rows.map((row) => [row.id, row.name]));
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    const body = idsIn(visible)
      .map((id) => rows.find((row) => row.id === id))
      .filter((row): row is CategoryRow => Boolean(row))
      .map((row) =>
        [
          row.id,
          row.name,
          row.slug,
          row.parentId ? (nameById.get(row.parentId) ?? '') : '',
          row.productCount,
          row.isActive ? 'active' : 'hidden',
          row.showInMenu ? 'yes' : 'no',
          row.isFeatured ? 'yes' : 'no',
          row.sortOrder,
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
    link.download = 'categories.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // ----------------------------------------------------------------- view

  const resetAll = () => {
    setFilters({ search: '', status: 'all', visibility: 'all', parent: 'all' });
    setTerm('');
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters((current) => ({ ...current, search: term }));
  };

  const change = <K extends keyof TreeFilters>(key: K, value: TreeFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleRow = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const parentOptions = React.useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  /*
   * Columns as data. A virtualised table only ever holds the rows on screen, so
   * it cannot size its columns from its contents — `InfiniteTable` declares them
   * in a `<colgroup>` and lays the table out fixed. `Category` carries no width:
   * it is the column that absorbs whatever is left, and the one the tree indents
   * into.
   */
  const columns: Column<CategoryNode>[] = [
    {
      key: 'grip',
      width: '2.75rem',
      className: 'pr-0',
      header: '',
      cell: (node) =>
        canManage && !filtering ? (
          <span
            draggable
            onDragStart={() => setDragId(node.id)}
            onDragEnd={() => {
              setDragId(null);
              setDropId(null);
            }}
            role="button"
            tabIndex={-1}
            aria-label={t('Reorder {name}', { name: node.name })}
            title={t('Drag to reorder among its siblings')}
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
              for (const id of allIds) {
                if (checked === true) next.add(id);
                else next.delete(id);
              }
              return next;
            })
          }
          aria-label={t('Select every category the filters kept')}
        />
      ),
      cell: (node) => (
        <Checkbox
          checked={selected.has(node.id)}
          onCheckedChange={(checked) => toggleRow(node.id, checked === true)}
          aria-label={t('Select {name}', { name: node.name })}
        />
      ),
    },
    {
      key: 'category',
      header: t('Category'),
      cell: (node) => {
        const hasChildren = node.children.length > 0;
        const isOpen = expanded.has(node.id);

        return (
          <div className="flex items-center gap-2" style={{ paddingLeft: node.depth * 24 }}>
            {node.depth > 0 ? (
              <CornerDownRight className="size-3.5 shrink-0 text-border-strong" aria-hidden />
            ) : null}

            {hasChildren ? (
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
                aria-expanded={isOpen}
                aria-label={
                  isOpen ? t('Collapse {name}', { name: node.name }) : t('Expand {name}', { name: node.name })
                }
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')}
                  aria-hidden
                />
              </button>
            ) : (
              <span className="size-5 shrink-0" aria-hidden />
            )}

            <LazyImage
              src={node.imageUrl}
              alt=""
              className="size-8 rounded-lg border border-border"
              fallback={
                <span className={cn('grid size-8 place-items-center rounded-lg', TINTS[tintFor(node.id)])}>
                  {node.depth === 0 ? <Layers className="size-4" /> : <Tag className="size-4" />}
                </span>
              }
            />

            <span className={cn('truncate', node.depth === 0 ? 'font-semibold' : 'font-medium')}>
              {node.name}
            </span>
          </div>
        );
      },
    },
    {
      key: 'products',
      width: '7rem',
      headClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      header: t('Products'),
      cell: (node) => t.number(node.productCount),
    },
    {
      key: 'status',
      width: '14rem',
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
                '{visible} — shoppers can reach it. {featured} — it leads the storefront navigation. {notInMenu} — reachable by link, but not listed.',
                {
                  visible: <b>{t('Visible')}</b>,
                  featured: <b>{t('Featured')}</b>,
                  notInMenu: <b>{t('Not in menu')}</b>,
                },
              )}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (node) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {node.isFeatured ? <Badge variant="warning">{t('Featured')}</Badge> : null}
          <Badge variant={node.isActive ? 'success' : 'neutral'}>
            {node.isActive ? t('Visible') : t('Hidden')}
          </Badge>
          {node.showInMenu ? null : <Badge variant="outline">{t('Not in menu')}</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      width: '11rem',
      headClassName: 'text-right',
      header: t('Actions'),
      cell: (node) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('View {name}', { name: node.name })}
            onClick={() => viewing.view(node)}
          >
            <Eye />
          </Button>

          {storefrontBase ? (
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={`${storefrontBase}/category/${node.slug}`}
                target="_blank"
                rel="noreferrer"
                aria-label={t('Open {name} on the storefront', { name: node.name })}
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
                aria-label={t('Edit {name}', { name: node.name })}
                onClick={() => setPanel({ open: true, row: node, parentId: null, sub: false })}
              >
                <Pencil />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('More actions for {name}', { name: node.name })}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => setPanel({ open: true, row: null, parentId: node.id, sub: true })}
                  >
                    <Plus /> {t('Add subcategory')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(node.isFeatured ? t('No longer featured.') : t('Featured.'), () =>
                        patch(node.id, { isFeatured: !node.isFeatured }),
                      )
                    }
                  >
                    <Star /> {node.isFeatured ? t('Remove from featured') : t('Mark as featured')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(node.isActive ? t('Hidden.') : t('Visible.'), () =>
                        patch(node.id, { isActive: !node.isActive }),
                      )
                    }
                  >
                    {node.isActive ? <EyeOff /> : <Eye />}
                    {node.isActive ? t('Hide from storefront') : t('Show on storefront')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(
                        node.showInMenu ? t('Removed from navigation.') : t('Added to navigation.'),
                        () => patch(node.id, { showInMenu: !node.showInMenu }),
                      )
                    }
                  >
                    <FolderTree />
                    {node.showInMenu ? t('Hide from navigation') : t('Show in navigation')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void removeOne(node)}>
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
        title={t('Categories')}
        breadcrumb={[{ label: t('Dashboard'), href: '/dashboard' }, { label: t('Categories') }]}
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
                  <DropdownMenuLabel>
                    {t('{count} selected', { count: selected.size })}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() =>
                      bulk(
                        (count) => t.plural(count, 'Made visible {count} category.', 'Made visible {count} categories.'),
                        (id) => patch(id, { isActive: true }),
                      )
                    }
                  >
                    <Eye /> {t('Make visible')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      bulk(
                        (count) => t.plural(count, 'Hidden {count} category.', 'Hidden {count} categories.'),
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
                        (count) => t.plural(count, 'Featured {count} category.', 'Featured {count} categories.'),
                        (id) => patch(id, { isFeatured: true }),
                      )
                    }
                  >
                    <Star /> {t('Mark featured')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      bulk(
                        (count) => t.plural(count, 'Unfeatured {count} category.', 'Unfeatured {count} categories.'),
                        (id) => patch(id, { isFeatured: false }),
                      )
                    }
                  >
                    <Star /> {t('Remove featured')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      bulk(
                        (count) =>
                          t.plural(count, 'Shown in navigation {count} category.', 'Shown in navigation {count} categories.'),
                        (id) => patch(id, { showInMenu: true }),
                      )
                    }
                  >
                    <FolderTree /> {t('Show in navigation')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      bulk(
                        (count) =>
                          t.plural(
                            count,
                            'Removed from navigation {count} category.',
                            'Removed from navigation {count} categories.',
                          ),
                        (id) => patch(id, { showInMenu: false }),
                      )
                    }
                  >
                    <FolderTree /> {t('Hide from navigation')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={bulkDelete}>
                    <Trash2 /> {t('Delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {/*
              * Two buttons because they make two different things: a top-level
              * category, and one that sits inside another. Each opens its own
              * form — the top-level one is not asked which parent to use, and
              * the subcategory one cannot be saved without being told. Same
              * weight as every other action up here, because neither is the
              * one the page is for.
              */}
            {canManage ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setPanel({ open: true, row: null, parentId: null, sub: false })}
                >
                  <Plus /> {t('Add Category')}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setPanel({ open: true, row: null, parentId: null, sub: true })}
                  disabled={rows.length === 0}
                  title={rows.length === 0 ? t('Add a category first — a subcategory sits inside one.') : undefined}
                >
                  <Plus /> {t('Add Subcategory')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {/* ------------------------------------------------------------ stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Layers}
          tint="primary"
          label={t('Total Categories')}
          value={stats.total}
          note={
            stats.addedThisMonth > 0
              ? t('+{count} added this month', { count: stats.addedThisMonth })
              : t('None added this month')
          }
          good={stats.addedThisMonth > 0}
        />
        <StatCard
          icon={FolderTree}
          tint="success"
          label={t('Subcategories')}
          value={stats.subcategories}
          note={t.plural(stats.parents, 'Inside {count} parent category', 'Inside {count} parent categories')}
        />
        <StatCard
          icon={Star}
          tint="warning"
          label={t('Featured Categories')}
          value={stats.featured}
          note={t('Lead the storefront navigation')}
        />
        <StatCard
          icon={EyeOff}
          tint="danger"
          label={t('Hidden Categories')}
          value={stats.hidden}
          note={t('Not visible to shoppers')}
        />
      </div>

      {/* ---------------------------------------------------------- filters */}
      <form
        onSubmit={applySearch}
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
            placeholder={t('Search categories…')}
            aria-label={t('Search categories')}
            className="pl-9"
          />
        </div>

        <select
          value={filters.parent}
          onChange={(event) => change('parent', event.target.value)}
          aria-label={t('Parent category')}
          className={cn(SELECT_CLASS, 'lg:w-52')}
        >
          <option value="all">{t('All Parent Categories')}</option>
          <option value="root">{t('Top level only')}</option>
          {parentOptions.map((row) => (
            <option key={row.id} value={row.id}>
              {t('Inside {name}', { name: row.name })}
            </option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(event) => change('status', event.target.value as TreeFilters['status'])}
          aria-label={t('Status')}
          className={cn(SELECT_CLASS, 'lg:w-40')}
        >
          <option value="all">{t('All Status')}</option>
          <option value="active">{t('Active')}</option>
          <option value="inactive">{t('Hidden')}</option>
        </select>

        <select
          value={filters.visibility}
          onChange={(event) => change('visibility', event.target.value as TreeFilters['visibility'])}
          aria-label={t('Navigation visibility')}
          className={cn(SELECT_CLASS, 'lg:w-44')}
        >
          <option value="all">{t('All Visibility')}</option>
          <option value="shown">{t('In navigation')}</option>
          <option value="hidden">{t('Not in navigation')}</option>
        </select>

        <div className="flex items-center gap-2 lg:ml-auto">
          <Button type="submit" variant="outline">
            <SlidersHorizontal /> {t('Filter')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" onClick={resetAll} aria-label={t('Reset filters')}>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('Reset filters')}</TooltipContent>
          </Tooltip>
        </div>
      </form>

      {/* ------------------------------------------------------------ table */}
      <InfiniteTable
        columns={columns}
        rows={flat}
        total={flat.length}
        noun="category"
        /*
         * Nothing to fetch: the whole tree arrived with the page, because a drag
         * reorder and the parent filter both need it whole. This is here for the
         * virtualisation and for one consistent table across the panel.
         */
        hasMore={false}
        loading={false}
        error={null}
        onLoadMore={() => {}}
        onRetry={() => {}}
        minWidth="66rem"
        estimateRowHeight={57}
        rowProps={(node) => ({
          onDragOver: (event) => {
            if (!dragId) return;
            event.preventDefault();
            setDropId(node.id);
          },
          onDragLeave: () => setDropId((current) => (current === node.id ? null : current)),
          onDrop: (event) => {
            event.preventDefault();
            void onDrop(node);
          },
        })}
        rowClassName={(node) =>
          cn(
            dropId === node.id && dragId !== node.id && 'bg-primary-soft/60',
            dragId === node.id && 'opacity-50',
          )
        }
        empty={
          rows.length === 0
            ? t('No categories yet. Add the first one to start grouping your products.')
            : t('No category matches these filters.')
        }
      />

      <CategoryDetail
        row={viewing.row}
        parent={viewing.row?.parentId ? (rows.find((row) => row.id === viewing.row?.parentId) ?? null) : null}
        childCount={viewing.row?.children.length ?? 0}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
        storefrontBase={storefrontBase}
      />

      <CategoryPanel
        open={panel.open}
        onOpenChange={(open) => setPanel((current) => ({ ...current, open }))}
        category={panel.row}
        presetParentId={panel.parentId}
        subcategory={panel.sub}
        all={rows}
        /*
         * A subcategory saved under a collapsed parent would land off screen
         * and read as a save that did nothing, so the branch it went into is
         * opened before the list is re-read.
         */
        onSaved={(parentId) => {
          if (parentId) setExpanded((current) => new Set(current).add(parentId));
          refresh();
        }}
      />
      </div>
    </TooltipProvider>
  );
}
