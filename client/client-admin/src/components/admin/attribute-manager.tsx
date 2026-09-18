'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  GripVertical,
  Info,
  ListTree,
  MoreVertical,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SwatchBook,
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
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AttributeRow } from '@/lib/types';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { AttributePanel } from './attribute-panel';
import { SELECT_CLASS } from './category-tree';

/**
 * The attribute screen: the vocabulary a catalogue varies and filters by.
 *
 * Two kinds, and the difference decides what a shopper gets. A **buying option**
 * (`isVariantAttribute`) means picking a value selects a different thing to buy,
 * with its own SKU, price and stock. A descriptive one only narrows a listing.
 * Getting that backwards is how a shop ends up with "Colour" as a filter that
 * cannot actually be bought, so the list says which each one is rather than
 * leaving it to a checkbox nobody reads.
 *
 * The whole set is read once — a shop has a handful of attributes — so the
 * counts, filters, ordering and page window are derived here, and a drag reorder
 * renumbers the real list rather than the rows that happen to be on screen.
 */

const PAGE_SIZES = [10, 25, 50, 100];

const INPUT_LABEL: Record<AttributeRow['inputType'], MessageKey> = {
  select: 'List',
  color: 'Swatches',
  text: 'Free text',
  number: 'Number::input',
};

export interface AttributeFilterState {
  search: string;
  kind: 'all' | 'variant' | 'descriptive';
  filterable: 'all' | 'yes' | 'no';
  inputType: 'all' | AttributeRow['inputType'];
  page: number;
  pageSize: number;
}

export function AttributeManager({
  rows,
  canManage,
  initial,
}: {
  rows: AttributeRow[];
  canManage: boolean;
  initial: AttributeFilterState;
}) {
  const router = useRouter();
  const t = useT();

  const [filters, setFilters] = React.useState({
    search: initial.search,
    kind: initial.kind,
    filterable: initial.filterable,
    inputType: initial.inputType,
  });
  const [term, setTerm] = React.useState(initial.search);
  const [page, setPage] = React.useState(initial.page);
  const [pageSize, setPageSize] = React.useState(initial.pageSize);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const [panel, setPanel] = React.useState<{ open: boolean; row: AttributeRow | null }>({
    open: false,
    row: null,
  });

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropId, setDropId] = React.useState<string | null>(null);

  // ---------------------------------------------------------------- derived

  const ordered = React.useMemo(
    () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [rows],
  );

  const visible = React.useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return ordered.filter((row) => {
      if (
        needle &&
        !row.name.toLowerCase().includes(needle) &&
        !row.slug.toLowerCase().includes(needle) &&
        !row.values.some((value) => value.value.toLowerCase().includes(needle))
      ) {
        return false;
      }
      if (filters.kind !== 'all' && row.isVariantAttribute !== (filters.kind === 'variant')) return false;
      if (filters.filterable !== 'all' && row.isFilterable !== (filters.filterable === 'yes')) return false;
      if (filters.inputType !== 'all' && row.inputType !== filters.inputType) return false;
      return true;
    });
  }, [ordered, filters]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  const filtering =
    filters.search.trim() !== '' ||
    filters.kind !== 'all' ||
    filters.filterable !== 'all' ||
    filters.inputType !== 'all';

  const stats = React.useMemo(
    () => ({
      total: rows.length,
      variant: rows.filter((row) => row.isVariantAttribute).length,
      filterable: rows.filter((row) => row.isFilterable).length,
      values: rows.reduce((sum, row) => sum + row.values.length, 0),
      unused: rows.filter((row) => row.productCount === 0).length,
    }),
    [rows],
  );

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(row.id));
  const someOnPageSelected = pageRows.some((row) => selected.has(row.id));

  // ------------------------------------------------------------------- url

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.kind !== 'all') params.set('kind', filters.kind);
    if (filters.filterable !== 'all') params.set('filterable', filters.filterable);
    if (filters.inputType !== 'all') params.set('type', filters.inputType);
    if (safePage > 1) params.set('page', String(safePage));
    if (pageSize !== PAGE_SIZES[0]) params.set('per', String(pageSize));

    const query = params.toString();
    globalThis.history.replaceState(null, '', query ? `?${query}` : globalThis.location.pathname);
  }, [filters, safePage, pageSize]);

  // ---------------------------------------------------------------- writes

  const refresh = () => {
    setSelected(new Set());
    router.refresh();
  };

  // i18n-ignore (a type argument, not text)
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

  /**
   * `PUT` is the only write the attribute endpoint offers, and it takes the whole
   * row — so a one-flag change has to send everything else back unchanged,
   * including the values. Sending them is safe: the API merges by id, so a value
   * round-tripped through here is updated in place rather than re-created.
   */
  const put = (row: AttributeRow, patch: Partial<AttributeRow>) =>
    api.put(`/api/v1/admin/attributes/${row.id}`, {
      name: patch.name ?? row.name,
      inputType: patch.inputType ?? row.inputType,
      isVariantAttribute: patch.isVariantAttribute ?? row.isVariantAttribute,
      isFilterable: patch.isFilterable ?? row.isFilterable,
      unit: patch.unit === undefined ? row.unit : patch.unit,
      sortOrder: patch.sortOrder ?? row.sortOrder,
      values: row.values.map((value) => ({
        id: value.id,
        value: value.value,
        colorHex: value.colorHex,
      })),
    });

  async function removeOne(row: AttributeRow) {
    const warning =
      row.productCount > 0
        ? `\n\n${t.plural(
            row.productCount,
            '{count} product uses it, so the API will refuse until they stop.',
            '{count} products use it, so the API will refuse until they stop.',
          )}`
        : '';
    if (
      !globalThis.confirm(
        `${t('Delete “{name}” and its {count} value(s)?', { name: row.name, count: row.values.length })}${warning}`,
      )
    ) {
      return;
    }
    await run(t('Attribute deleted.'), () => api.delete(`/api/v1/admin/attributes/${row.id}`));
  }

  // `done` words the success toast for however many rows were chosen. i18n-ignore (a type argument, not text)
  async function bulk(done: (count: number) => string, work: (row: AttributeRow) => Promise<unknown>) {
    const chosen = rows.filter((row) => selected.has(row.id));
    if (!chosen.length) return;

    setBusy(true);
    const results = await Promise.allSettled(chosen.map((row) => work(row)));
    const failed = results.filter((result) => result.status === 'rejected');
    setBusy(false);

    if (failed.length === 0) toast.success(done(chosen.length));
    else if (failed.length === chosen.length) {
      toast.error(errorMessage((failed[0] as PromiseRejectedResult).reason));
    } else {
      toast.error(
        t('{done} done, {refused} refused — see each row.', {
          done: chosen.length - failed.length,
          refused: failed.length,
        }),
      );
    }

    refresh();
  }

  async function bulkDelete() {
    const chosen = rows.filter((row) => selected.has(row.id));
    if (!chosen.length) return;

    const inUse = chosen.filter((row) => row.productCount > 0).length;
    const note = inUse
      ? `\n\n${t.plural(
          inUse,
          '{count} of them is used by products and will be refused.',
          '{count} of them are used by products and will be refused.',
        )}`
      : '';
    if (
      !globalThis.confirm(
        `${t.plural(chosen.length, 'Delete {count} attribute?', 'Delete {count} attributes?')}${note}`,
      )
    ) {
      return;
    }

    await bulk(
      (count) => t.plural(count, 'Deleted {count} attribute.', 'Deleted {count} attributes.'),
      (row) => api.delete(`/api/v1/admin/attributes/${row.id}`),
    );
  }

  // -------------------------------------------------------------- reorder

  async function onDrop(target: AttributeRow) {
    const sourceId = dragId;
    setDragId(null);
    setDropId(null);
    if (!sourceId || sourceId === target.id) return;

    const ids = ordered.map((row) => row.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(target.id);
    if (from < 0 || to < 0) return;

    ids.splice(to, 0, ids.splice(from, 1)[0]!);

    await run(t('Order saved.'), () =>
      api.patch('/api/v1/admin/attributes/reorder', {
        order: ids.map((id, index) => ({ id, sortOrder: index })),
      }),
    );
  }

  // --------------------------------------------------------------- export

  function exportCsv() {
    const header = ['id', 'name', 'slug', 'kind', 'shown_as', 'unit', 'filterable', 'values', 'products', 'sort_order'];
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    const body = visible.map((row) =>
      [
        row.id,
        row.name,
        row.slug,
        row.isVariantAttribute ? 'buying option' : 'descriptive',
        row.inputType,
        row.unit ?? '',
        row.isFilterable ? 'yes' : 'no',
        row.values.map((value) => value.value).join(' | '),
        row.productCount,
        row.sortOrder,
      ]
        .map(cell)
        .join(','),
    );

    const blob = new Blob([[header.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attributes.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // ----------------------------------------------------------------- view

  const change = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PageHeader
          title={t('Attributes')}
          breadcrumb={[{ label: t('Dashboard'), href: '/dashboard' }, { label: t('Attributes') }]}
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
                          (count) =>
                            t.plural(
                              count,
                              'Offered as a filter {count} attribute.',
                              'Offered as a filter {count} attributes.',
                            ),
                          (row) => put(row, { isFilterable: true }),
                        )
                      }
                    >
                      <Filter /> {t('Offer as a filter')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        bulk(
                          (count) =>
                            t.plural(
                              count,
                              'Removed from filters {count} attribute.',
                              'Removed from filters {count} attributes.',
                            ),
                          (row) => put(row, { isFilterable: false }),
                        )
                      }
                    >
                      <Filter /> {t('Remove from filters')}
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
                  <Plus /> {t('Add Attribute')}
                </Button>
              ) : null}
            </>
          }
        />

        {/* ---------------------------------------------------------- stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Boxes}
            tint="primary"
            label={t('Total Attributes')}
            value={stats.total}
            note={
              stats.unused > 0
                ? t('{count} not used by any product', { count: stats.unused })
                : t('All in use')
            }
          />
          <StatCard
            icon={SwatchBook}
            tint="success"
            label={t('Buying Options')}
            value={stats.variant}
            note={t('{count} descriptive only', { count: stats.total - stats.variant })}
          />
          <StatCard
            icon={Filter}
            tint="warning"
            label={t('Storefront Filters')}
            value={stats.filterable}
            note={t('Offered in the filter panel')}
          />
          <StatCard
            icon={ListTree}
            tint="danger"
            label={t('Total Values')}
            value={stats.values}
            note={t('Choices across every attribute')}
          />
        </div>

        {/* -------------------------------------------------------- filters */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFilters((current) => ({ ...current, search: term }));
            setPage(1);
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
              placeholder={t('Search attributes or values…')}
              aria-label={t('Search attributes')}
              className="pl-9"
            />
          </div>

          <select
            value={filters.kind}
            onChange={(event) => change('kind', event.target.value as AttributeFilterState['kind'])}
            aria-label={t('Kind')}
            className={cn(SELECT_CLASS, 'lg:w-48')}
          >
            <option value="all">{t('All Kinds')}</option>
            <option value="variant">{t('Buying options')}</option>
            <option value="descriptive">{t('Descriptive only')}</option>
          </select>

          <select
            value={filters.filterable}
            onChange={(event) => change('filterable', event.target.value as AttributeFilterState['filterable'])}
            aria-label={t('Filterable')}
            className={cn(SELECT_CLASS, 'lg:w-44')}
          >
            <option value="all">{t('Filter or not')}</option>
            <option value="yes">{t('Offered as filter')}</option>
            <option value="no">{t('Not a filter')}</option>
          </select>

          <select
            value={filters.inputType}
            onChange={(event) => change('inputType', event.target.value as AttributeFilterState['inputType'])}
            aria-label={t('Shown as')}
            className={cn(SELECT_CLASS, 'lg:w-40')}
          >
            <option value="all">{t('All Types')}</option>
            <option value="select">{t(INPUT_LABEL.select)}</option>
            <option value="color">{t(INPUT_LABEL.color)}</option>
            <option value="text">{t(INPUT_LABEL.text)}</option>
            <option value="number">{t(INPUT_LABEL.number)}</option>
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
                    setFilters({ search: '', kind: 'all', filterable: 'all', inputType: 'all' });
                    setTerm('');
                    setPage(1);
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
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const row of pageRows) {
                          if (checked === true) next.add(row.id);
                          else next.delete(row.id);
                        }
                        return next;
                      })
                    }
                    aria-label={t('Select every attribute on this page')}
                  />
                </TableHead>
                <TableHead className="w-56">{t('Attribute')}</TableHead>
                <TableHead>{t('Values')}</TableHead>
                <TableHead className="w-28 text-right">{t('Products')}</TableHead>
                <TableHead className="w-52">
                  <span className="inline-flex items-center gap-1.5">
                    {t('Kind')}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label={t('What these badges mean')}>
                          <Info className="size-3.5" aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72">
                        {t.rich(
                          '{buyingOption} — picking a value selects a different thing to buy, with its own SKU, price and stock. {descriptive} — it only narrows a listing. {filter} — offered in the storefront’s filter panel.',
                          {
                            buyingOption: <b>{t('Buying option')}</b>,
                            descriptive: <b>{t('Descriptive')}</b>,
                            filter: <b>{t('Filter')}</b>,
                          },
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </TableHead>
                <TableHead className="w-28 text-right">{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {pageRows.length === 0 ? (
                <TableEmpty colSpan={7}>
                  {rows.length === 0
                    ? t('No attributes yet. Add one to give products options like size or colour.')
                    : t('No attribute matches these filters.')}
                </TableEmpty>
              ) : (
                pageRows.map((row) => {
                  const reorderable = canManage && !filtering;
                  const shown = row.values.slice(0, 6);

                  return (
                    <TableRow
                      key={row.id}
                      onDragOver={(event) => {
                        if (!dragId) return;
                        event.preventDefault();
                        setDropId(row.id);
                      }}
                      onDragLeave={() => setDropId((current) => (current === row.id ? null : current))}
                      onDrop={(event) => {
                        event.preventDefault();
                        void onDrop(row);
                      }}
                      className={cn(
                        dropId === row.id && dragId !== row.id && 'bg-primary-soft/60',
                        dragId === row.id && 'opacity-50',
                      )}
                    >
                      <TableCell className="pr-0">
                        {reorderable ? (
                          <span
                            draggable
                            onDragStart={() => setDragId(row.id)}
                            onDragEnd={() => {
                              setDragId(null);
                              setDropId(null);
                            }}
                            role="button"
                            tabIndex={-1}
                            aria-label={t('Reorder {name}', { name: row.name })}
                            title={t('Drag to reorder')}
                            className="grid size-6 cursor-grab place-items-center text-muted-foreground active:cursor-grabbing"
                          >
                            <GripVertical className="size-4" aria-hidden />
                          </span>
                        ) : (
                          <span className="grid size-6 place-items-center text-border-strong" aria-hidden>
                            <GripVertical className="size-4" />
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="pr-0">
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
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              'grid size-10 shrink-0 place-items-center rounded-lg',
                              row.inputType === 'color'
                                ? 'bg-warning-soft text-warning'
                                : 'bg-primary-soft text-accent-foreground',
                            )}
                            aria-hidden
                          >
                            {row.inputType === 'color' ? (
                              <Palette className="size-4" />
                            ) : (
                              <Boxes className="size-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              {row.name}
                              {row.unit ? (
                                <span className="font-normal text-muted-foreground"> ({row.unit})</span>
                              ) : null}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t(INPUT_LABEL[row.inputType])} ·{' '}
                              {t.plural(row.values.length, '{count} value', '{count} values')}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        {row.values.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t('No values yet.')}</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {shown.map((value) => (
                              <Badge key={value.id} variant="neutral">
                                {value.colorHex ? (
                                  <span
                                    className="size-2.5 rounded-full border border-border"
                                    style={{ backgroundColor: value.colorHex }}
                                    aria-hidden
                                  />
                                ) : null}
                                {value.value}
                              </Badge>
                            ))}
                            {row.values.length > shown.length ? (
                              <span className="text-xs text-muted-foreground">
                                {t('+{count} more', { count: row.values.length - shown.length })}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t.number(row.productCount)}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={row.isVariantAttribute ? 'success' : 'neutral'}>
                            {row.isVariantAttribute ? t('Buying option') : t('Descriptive')}
                          </Badge>
                          {row.isFilterable ? <Badge variant="info">{t('Filter')}</Badge> : null}
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          {canManage ? (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('Edit {name}', { name: row.name })}
                                    onClick={() => setPanel({ open: true, row })}
                                  >
                                    <Pencil />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('Edit and manage values')}</TooltipContent>
                              </Tooltip>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('More actions for {name}', { name: row.name })}
                                  >
                                    <MoreVertical />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void run(
                                        row.isFilterable ? t('Removed from filters.') : t('Offered as a filter.'),
                                        () => put(row, { isFilterable: !row.isFilterable }),
                                      )
                                    }
                                  >
                                    <Filter />
                                    {row.isFilterable ? t('Remove from filters') : t('Offer as a filter')}
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
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableWrapper>

        {/* ----------------------------------------------------- pagination */}
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            {visible.length === 0
              ? t('No attributes to show')
              : t.plural(
                  visible.length,
                  'Showing {from} to {to} of {count} attribute',
                  'Showing {from} to {to} of {count} attributes',
                  {
                    from: (safePage - 1) * pageSize + 1,
                    to: Math.min(safePage * pageSize, visible.length),
                  },
                )}
          </p>

          <div className="flex items-center gap-3">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              aria-label={t('Attributes per page')}
              className={cn(SELECT_CLASS, 'h-9 w-36')}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {t('{count} per page', { count: size })}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                aria-label={t('Previous page')}
              >
                <ChevronLeft />
              </Button>
              {pageWindow(safePage, totalPages).map((entry, index) =>
                entry === null ? (
                  <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={entry}
                    variant={entry === safePage ? 'primary' : 'outline'}
                    size="icon-sm"
                    onClick={() => setPage(entry)}
                    aria-current={entry === safePage ? 'page' : undefined}
                  >
                    {t.number(entry)}
                  </Button>
                ),
              )}
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                aria-label={t('Next page')}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>

        <AttributePanel
          open={panel.open}
          onOpenChange={(open) => setPanel((current) => ({ ...current, open }))}
          attribute={panel.row}
          onSaved={refresh}
        />
      </div>
    </TooltipProvider>
  );
}

/** First, last, and the pages either side of the current one; `null` is a gap. */
function pageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push(null);
    out.push(page);
    previous = page;
  }
  return out;
}
