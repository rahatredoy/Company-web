'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Banknote,
  ChevronDown,
  CircleSlash,
  Clock,
  Download,
  Eye,
  Info,
  MoreVertical,
  Receipt,
  RotateCcw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toaster';
import { api, apiFetchListed, errorMessage, type ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import { titleCase } from '@/lib/format';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { OrderRow, OrderStats, OrderStatus } from '@/lib/types';
import { InfiniteTable, type Column } from './infinite-table';
import { OrderDetail } from './order-detail';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { SELECT_CLASS } from './category-tree';

/**
 * The order list, and every move that can be made from it.
 *
 * Server-filtered and server-paginated: an order book only grows, so the filters
 * travel in the URL and the page re-reads. `useTransition` keeps the table on
 * screen — dimmed — while the next page arrives.
 *
 * **What an order may become next is the API's answer, not this screen's.** Each
 * row carries `allowedTransitions` from the same map the write re-checks, so a
 * stale page offers nothing illegal, and if it somehow does the API answers 409
 * with a sentence worth showing. The bulk menu offers the *intersection* of what
 * every selected order allows, so a mass move cannot half-succeed by design.
 */

/** The order statuses, in the order an order actually travels through them. */
const STATUS_OPTIONS: OrderStatus[] = [
  'new',
  'pending',
  'confirmed',
  'processing',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'refunded',
  'failed',
];

/** How each status reads as a word — an option in the filter, the toast after a move. */
const STATUS_LABEL: Record<OrderStatus, MessageKey> = {
  new: 'New',
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out For Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  refunded: 'Refunded',
  failed: 'Failed',
};

const PAYMENT_OPTIONS = [
  'pending',
  'cod_pending',
  'paid',
  'partially_paid',
  'partially_refunded',
  'refunded',
  'failed',
] as const;

const PAYMENT_LABEL: Record<(typeof PAYMENT_OPTIONS)[number], MessageKey> = {
  pending: 'Pending',
  cod_pending: 'Cod Pending',
  paid: 'Paid',
  partially_paid: 'Partially Paid',
  partially_refunded: 'Partially Refunded',
  refunded: 'Refunded',
  failed: 'Failed',
};

/**
 * How a payment provider is written for a person. `titleCase` turns `cod` into
 * "Cod", which reads as a fish — these are proper names, not slugs, and the
 * fallback keeps an adapter added later legible until it is named here.
 */
const PROVIDER_LABEL: Record<string, MessageKey> = {
  cod: 'Cash on Delivery',
  mock: 'Test gateway',
};

/** Brand names, written the same in every language. */
const PROVIDER_NAME: Record<string, string> = {
  stripe: 'Stripe',
  sslcommerz: 'SSLCommerz',
};

/** What each move is called in a menu, where "delivered" alone reads as a state. */
const MOVE_LABEL: Record<OrderStatus, MessageKey> = {
  new: 'Move back to new',
  pending: 'Mark as pending',
  confirmed: 'Confirm order',
  processing: 'Start processing',
  packed: 'Mark as packed',
  shipped: 'Mark as shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Mark as delivered',
  cancelled: 'Cancel order',
  returned: 'Mark as returned',
  refunded: 'Mark as refunded',
  failed: 'Mark as failed',
};

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'custom';

export interface OrderFilterState {
  search: string;
  status: string;
  paymentStatus: string;
  needsAction: 'all' | 'yes';
  preset: DatePreset;
  from: string;
  to: string;
  sort: 'placedAt' | 'grandTotal' | 'orderNumber';
  order: 'asc' | 'desc';
}

export const ORDER_DEFAULTS: OrderFilterState = {
  search: '',
  status: 'all',
  paymentStatus: 'all',
  needsAction: 'all',
  preset: 'all',
  from: '',
  to: '',
  sort: 'placedAt',
  order: 'desc',
};

/** Exactly what the API is asked for, so the first batch and the rest agree. */
function queryFor(filters: OrderFilterState) {
  return {
    search: filters.search.trim() || undefined,
    status: filters.status,
    paymentStatus: filters.paymentStatus,
    needsAction: filters.needsAction,
    from: filters.from || undefined,
    to: filters.to || undefined,
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
  sort: OrderFilterState['sort'];
  children: React.ReactNode;
  active: OrderFilterState['sort'];
  order: 'asc' | 'desc';
  onSort: (sort: OrderFilterState['sort']) => void;
}) {
  const t = useT();
  const on = active === sort;

  return (
    <button
      type="button"
      onClick={() => onSort(sort)}
      aria-label={t('Sort by {column}', { column: String(children) })}
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

export function OrderManager({
  initial,
  stats,
  currency,
  canUpdate,
  canCancel,
  filters,
  initialView,
}: {
  /** The first batch, rendered on the server. The rest arrive by cursor. */
  initial: { rows: OrderRow[]; meta: ListMeta };
  stats: OrderStats | null;
  currency: string;
  canUpdate: boolean;
  canCancel: boolean;
  filters: OrderFilterState;
  /** An order named by `?view=<id>` — how every other screen links to an order. */
  initialView: OrderRow | null;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = React.useTransition();

  const query = React.useMemo(() => queryFor(filters), [filters]);
  const list = useInfiniteList<OrderRow>({ path: '/api/v1/admin/orders', query, initial });
  const rows = list.rows;

  const [term, setTerm] = React.useState(filters.search);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  /*
   * The order panel, beside the list rather than instead of it. It is the only
   * place an order is read: the whole order, its lines, both addresses, the
   * payments, the history, and the returns and refunds raised against it —
   * without losing a place in a virtualised list the browser cannot scroll back
   * to. Moving the status and writing the staff note happen here too.
   */
  const viewing = useViewTarget<OrderRow>();
  const { view, onOpenChange } = viewing;

  /*
   * Another screen links to an order as `/orders?view=<id>`, so the panel opens
   * on arrival. Closing it drops `view` from the address without a navigation —
   * a refresh or a filter change must not reopen an order the reader shut.
   */
  const openedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (initialView && initialView.id !== openedFor.current) {
      openedFor.current = initialView.id;
      view(initialView);
    }
  }, [initialView, view]);

  const changeOpen = React.useCallback(
    (open: boolean) => {
      onOpenChange(open);
      if (!open && new URLSearchParams(window.location.search).has('view')) {
        const params = new URLSearchParams(window.location.search);
        params.delete('view');
        const query = params.toString();
        window.history.replaceState(null, '', query ? `/orders?${query}` : '/orders');
      }
    },
    [onOpenChange],
  );

  /*
   * A selection cannot outlive the rows it was made on: acting on an id that is
   * no longer listed would move an order the user can no longer see. Cleared
   * during render rather than in an effect, which would leave one frame where the
   * checkboxes disagreed with the table.
   */
  // Keyed on the *first* batch, not on every row: scrolling more rows in only
  // ever appends, and throwing the selection away for that would be gratuitous.
  const signature = initial.rows.map((row) => row.id).join(',');
  const [lastSignature, setLastSignature] = React.useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    if (selected.size) setSelected(new Set());
  }

  const [lastSearch, setLastSearch] = React.useState(filters.search);
  if (filters.search !== lastSearch) {
    setLastSearch(filters.search);
    setTerm(filters.search);
  }

  // ------------------------------------------------------------------ url

  const urlFor = (patch: Partial<OrderFilterState>): string => {
    const next: OrderFilterState = { ...filters, ...patch };

    const params = new URLSearchParams();
    if (next.search.trim()) params.set('search', next.search.trim());
    if (next.status !== 'all') params.set('status', next.status);
    if (next.paymentStatus !== 'all') params.set('payment', next.paymentStatus);
    if (next.needsAction !== 'all') params.set('open', next.needsAction);
    if (next.preset !== 'all') params.set('range', next.preset);
    if (next.preset === 'custom') {
      if (next.from) params.set('from', next.from);
      if (next.to) params.set('to', next.to);
    }
    if (next.sort !== ORDER_DEFAULTS.sort) params.set('sort', next.sort);
    if (next.order !== ORDER_DEFAULTS.order) params.set('order', next.order);

    const query = params.toString();
    return query ? `/orders?${query}` : '/orders';
  };

  const apply = (patch: Partial<OrderFilterState>) => {
    startTransition(() => router.push(urlFor(patch)));
  };

  const sortBy = (sort: OrderFilterState['sort']) =>
    apply(
      filters.sort === sort
        ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
        : { sort, order: sort === 'orderNumber' ? 'asc' : 'desc' },
    );

  const filtering =
    filters.search.trim() !== '' ||
    filters.status !== 'all' ||
    filters.paymentStatus !== 'all' ||
    filters.needsAction !== 'all' ||
    filters.preset !== 'all';

  // --------------------------------------------------------------- writes

  const refresh = () => {
    setSelected(new Set());
    router.refresh();
  };

  const move = (id: string, status: OrderStatus, note?: string) =>
    api.patch(`/api/v1/admin/orders/${id}/status`, { status, ...(note ? { note } : {}) });

  /** Resolves true when the move was made, so the View panel knows to re-read the order. */
  async function moveOne(row: OrderRow, status: OrderStatus): Promise<boolean> {
    let note: string | undefined;

    // Cancelling is the one move a customer sees a reason for, and the API stores
    // whatever it is given as `cancel_reason`.
    if (status === 'cancelled' || status === 'failed') {
      const reason = globalThis.prompt(
        status === 'cancelled'
          ? t('Why is {order} being cancelled? The customer sees this.', { order: row.orderNumber })
          : t('Why is {order} being marked failed? The customer sees this.', { order: row.orderNumber }),
        '',
      );
      if (reason === null) return false;
      note = reason.trim() || undefined;
    }

    setBusy(true);
    try {
      await move(row.id, status, note);
      toast.success(t('{number} is now {status}.', { number: row.orderNumber, status: t(STATUS_LABEL[status]) }));
      refresh();
      return true;
    } catch (caught) {
      // A 409 here means the page was stale — the API's sentence says which move
      // it refused and from what, which is more use than "failed".
      toast.error(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * The moves every selected order can make. An intersection rather than a union:
   * offering a move that only some of them allow guarantees a partial failure, and
   * a bulk action that half-works on an order book is the worst outcome here.
   */
  const sharedMoves = React.useMemo(() => {
    const chosen = rows.filter((row) => selected.has(row.id));
    if (!chosen.length) return [] as OrderStatus[];

    return chosen
      .reduce<OrderStatus[]>(
        (shared, row) => shared.filter((status) => row.allowedTransitions.includes(status)),
        [...(chosen[0]?.allowedTransitions ?? [])],
      )
      .filter((status) => status !== 'cancelled' && status !== 'failed' || canCancel);
  }, [rows, selected, canCancel]);

  async function bulkMove(status: OrderStatus) {
    const ids = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
    if (!ids.length) return;

    if (
      (status === 'cancelled' || status === 'failed') &&
      !globalThis.confirm(
        status === 'cancelled'
          ? t.plural(ids.length, 'Cancel Order for {count} order?', 'Cancel Order for {count} orders?')
          : t.plural(ids.length, 'Mark As Failed for {count} order?', 'Mark As Failed for {count} orders?'),
      )
    ) {
      return;
    }

    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => move(id, status)));
    const failed = results.filter((result) => result.status === 'rejected');
    setBusy(false);

    if (failed.length === 0) {
      toast.success(
        t.plural(ids.length, '{count} order now {status}.', '{count} orders now {status}.', {
          status: t(STATUS_LABEL[status]),
        }),
      );
    } else if (failed.length === ids.length) {
      toast.error(errorMessage((failed[0] as PromiseRejectedResult).reason));
    } else {
      toast.error(
        t('{moved} moved, {refused} refused — see each row.', {
          moved: ids.length - failed.length,
          refused: failed.length,
        }),
      );
    }

    refresh();
  }

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
      const collected: OrderRow[] = [];
      let cursor: string | null | undefined;

      while (collected.length < EXPORT_CAP) {
        const batch = await apiFetchListed<OrderRow>('/api/v1/admin/orders', {
          query: { ...query, pageSize: EXPORT_BATCH, cursor: cursor ?? undefined },
        });
        collected.push(...batch.data);
        cursor = batch.meta.nextCursor;
        if (!batch.meta.hasMore || !cursor) break;
      }

      const header = [
        'order_number',
        'placed_at',
        'customer',
        'email',
        'phone',
        'items',
        'total',
        'currency',
        'status',
        'payment_status',
        'payment_method',
      ];
      const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

      const body = collected.map((row) =>
        [
          row.orderNumber,
          row.placedAt,
          row.customerName,
          row.email,
          row.phone ?? '',
          row.itemCount,
          row.grandTotal,
          row.currency,
          row.status,
          row.paymentStatus,
          row.paymentProvider ?? '',
        ]
          .map(cell)
          .join(','),
      );

      const blob = new Blob([[header.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'orders.csv';
      link.click();
      URL.revokeObjectURL(url);

      if (list.total !== null && list.total > collected.length) {
        toast.error(t('Exported the first {shown} of {total}.', { shown: collected.length, total: list.total }));
      } else {
        toast.success(t.plural(collected.length, 'Exported {count} order.', 'Exported {count} orders.'));
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

  const countOf = (map: Record<string, number> | undefined, key: string) =>
    map && map[key] !== undefined ? ` (${t.number(map[key]!)})` : '';

  /*
   * Columns as data. A virtualised table only ever holds the rows on screen, so
   * it cannot size its columns from its contents — `InfiniteTable` declares them
   * in a `<colgroup>` and lays the table out fixed. `Customer` carries no width:
   * it is the column that absorbs whatever is left.
   */
  const columns: Column<OrderRow>[] = [
    {
      key: 'select',
      width: '3rem',
      className: 'pr-0',
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={(checked) =>
            setSelected(() => (checked === true ? new Set(rows.map((row) => row.id)) : new Set()))
          }
          aria-label={t('Select every order loaded')}
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
          aria-label={t('Select {order}', { order: row.orderNumber })}
        />
      ),
    },
    {
      key: 'order',
      width: '12rem',
      header: (
        <SortButton sort="orderNumber" active={filters.sort} order={filters.order} onSort={sortBy}>
          {t('Order')}
        </SortButton>
      ),
      cell: (row) => (
        <>
          <button
            type="button"
            onClick={() => viewing.view(row)}
            className="font-mono text-sm font-semibold hover:underline"
          >
            {row.orderNumber}
          </button>
          {row.paymentProvider ? (
            <p className="truncate text-xs text-muted-foreground">
              {PROVIDER_LABEL[row.paymentProvider]
                ? t(PROVIDER_LABEL[row.paymentProvider]!)
                : (PROVIDER_NAME[row.paymentProvider] ?? t.loose(titleCase(row.paymentProvider)))}
            </p>
          ) : null}
        </>
      ),
    },
    {
      key: 'customer',
      header: t('Customer'),
      className: 'min-w-0',
      cell: (row) => (
        <>
          {row.customerId ? (
            <Link href={`/customers?view=${row.customerId}`} className="block truncate font-medium hover:underline">
              {row.customerName}
            </Link>
          ) : (
            <span className="flex items-center gap-1.5 truncate font-medium">
              {row.customerName}
              <Badge variant="outline">{t('Guest')}</Badge>
            </span>
          )}
          <p className="truncate text-xs text-muted-foreground">{row.phone ?? row.email}</p>
        </>
      ),
    },
    {
      key: 'placed',
      width: '11rem',
      className: 'text-sm text-muted-foreground',
      header: (
        <SortButton sort="placedAt" active={filters.sort} order={filters.order} onSort={sortBy}>
          {t('Placed')}
        </SortButton>
      ),
      cell: (row) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{t.relative(row.placedAt)}</span>
          </TooltipTrigger>
          <TooltipContent>{t.dateTime(row.placedAt)}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'status',
      width: '11rem',
      header: (
        <span className="inline-flex items-center gap-1.5">
          {t('Status')}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={t('What these statuses mean')}>
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {t(
                'An order travels new → confirmed → processing → packed → shipped → delivered. Only the moves the API allows are offered, and it re-checks every one.',
              )}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'payment',
      width: '10rem',
      header: t('Payment'),
      cell: (row) => <StatusBadge status={row.paymentStatus} />,
    },
    {
      key: 'items',
      width: '5.5rem',
      header: t('Items'),
      headClassName: 'text-right',
      className: 'text-right tabular-nums text-muted-foreground',
      cell: (row) => t.number(row.itemCount),
    },
    {
      key: 'total',
      width: '9rem',
      headClassName: 'text-right',
      className: 'text-right font-medium tabular-nums whitespace-nowrap',
      header: (
        <SortButton sort="grandTotal" active={filters.sort} order={filters.order} onSort={sortBy}>
          {t('Total')}
        </SortButton>
      ),
      cell: (row) => t.money(row.grandTotal, row.currency || currency),
    },
    {
      key: 'actions',
      width: '10rem',
      headClassName: 'text-right',
      header: t('Actions'),
      cell: (row) => {
        const moves = row.allowedTransitions.filter(
          (status) => (status !== 'cancelled' && status !== 'failed') || canCancel,
        );

        return (
          <div className="flex items-center justify-end gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('View {order}', { order: row.orderNumber })}
                  onClick={() => viewing.view(row)}
                >
                  <Eye />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('View every detail')}</TooltipContent>
            </Tooltip>

            {canUpdate ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t('Move {order} on', { order: row.orderNumber })}
                  >
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuLabel>{row.orderNumber}</DropdownMenuLabel>
                  {moves.length === 0 ? (
                    <DropdownMenuItem disabled>
                      <CircleSlash /> {t('Nothing left to do')}
                    </DropdownMenuItem>
                  ) : (
                    moves.map((status) => (
                      <DropdownMenuItem
                        key={status}
                        destructive={status === 'cancelled' || status === 'failed'}
                        onSelect={() => void moveOne(row, status)}
                      >
                        <ArrowRight /> {t(MOVE_LABEL[status])}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PageHeader
          title={t('Orders')}
          breadcrumb={[{ label: t('Dashboard'), href: '/dashboard' }, { label: t('Orders') }]}
          actions={
            <>
              <Button variant="outline" onClick={exportCsv} loading={exporting} disabled={rows.length === 0}>
                {exporting ? null : <Download />} {t('Export')}
              </Button>

              {canUpdate ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={selected.size === 0 || busy}>
                      {t('Bulk Actions')}
                      {selected.size ? <Badge variant="primary">{t.number(selected.size)}</Badge> : null}
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    <DropdownMenuLabel>{t('{count} selected', { count: selected.size })}</DropdownMenuLabel>
                    {sharedMoves.length === 0 ? (
                      <DropdownMenuItem disabled>
                        <CircleSlash /> {t('No move they all allow')}
                      </DropdownMenuItem>
                    ) : (
                      sharedMoves.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          destructive={status === 'cancelled' || status === 'failed'}
                          onSelect={() => void bulkMove(status)}
                        >
                          <ArrowRight /> {t(MOVE_LABEL[status])}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          }
        />

        {/* ---------------------------------------------------------- stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={ShoppingCart}
            tint="primary"
            label={t('Orders Today')}
            value={t.number(stats?.todayOrders ?? 0)}
            note={
              stats
                ? t('{amount} taken today · {timezone}', {
                    amount: t.money(stats.todayRevenue, currency),
                    timezone: stats.timezone,
                  })
                : t('Counted in the store’s own timezone')
            }
            good={(stats?.todayOrders ?? 0) > 0}
          />
          <StatCard
            icon={Clock}
            tint="warning"
            label={t('Awaiting Action')}
            value={t.number(stats?.openOrders ?? 0)}
            note={t('New, confirmed, processing or packed')}
            href={stats && stats.openOrders > 0 ? '/orders?open=yes' : undefined}
          />
          <StatCard
            icon={Banknote}
            tint="danger"
            label={t('Unpaid')}
            value={t.number(stats?.unpaid ?? 0)}
            note={t('Payment still outstanding')}
          />
          <StatCard
            icon={Receipt}
            tint="success"
            label={t('Revenue (30 days)')}
            value={t.money(stats?.revenue30d ?? 0, currency)}
            note={
              stats
                ? t('{amount} average order', { amount: t.money(stats.averageOrderValue, currency) })
                : t('Cancelled orders excluded')
            }
          />
        </div>

        {/* -------------------------------------------------------- filters */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply({ search: term });
          }}
          className="space-y-3 rounded-xl border border-border bg-card p-3"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-xs">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={t('Order number, name, email or phone…')}
                aria-label={t('Search orders')}
                className="pl-9"
              />
            </div>

            <select
              value={filters.status}
              onChange={(event) => apply({ status: event.target.value })}
              aria-label={t('Order status')}
              className={cn(SELECT_CLASS, 'lg:w-52')}
            >
              <option value="all">
                {t('All Status')}
                {countOf({ all: stats?.total ?? 0 }, 'all')}
              </option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {t(STATUS_LABEL[status])}
                  {countOf(stats?.byStatus, status)}
                </option>
              ))}
            </select>

            <select
              value={filters.paymentStatus}
              onChange={(event) => apply({ paymentStatus: event.target.value })}
              aria-label={t('Payment status')}
              className={cn(SELECT_CLASS, 'lg:w-52')}
            >
              <option value="all">{t('All Payments')}</option>
              {PAYMENT_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {t(PAYMENT_LABEL[status])}
                  {countOf(stats?.byPaymentStatus, status)}
                </option>
              ))}
            </select>

            <select
              value={filters.preset}
              onChange={(event) => {
                const preset = event.target.value as DatePreset;
                apply(preset === 'custom' ? { preset } : { preset, from: '', to: '' });
              }}
              aria-label={t('Date range')}
              className={cn(SELECT_CLASS, 'lg:w-44')}
            >
              <option value="all">{t('Any date')}</option>
              <option value="today">{t('Today')}</option>
              <option value="week">{t('Last 7 days')}</option>
              <option value="month">{t('Last 30 days')}</option>
              <option value="custom">{t('Custom range…')}</option>
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
                      startTransition(() => router.push('/orders'));
                    }}
                    aria-label={t('Reset filters')}
                  >
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('Reset filters')}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {filters.preset === 'custom' ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <label className="text-xs text-muted-foreground">
                {t('From')}
                <Input
                  type="date"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(event) => apply({ from: event.target.value })}
                  className="mt-1 w-44"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                {t('To')}
                <Input
                  type="date"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(event) => apply({ to: event.target.value })}
                  className="mt-1 w-44"
                />
              </label>
              <p className="pb-2 text-xs text-muted-foreground">{t('Both ends included.')}</p>
            </div>
          ) : null}
        </form>

        {/* ---------------------------------------------------------- table */}
        {/* ---------------------------------------------------------- table */}
        <InfiniteTable
          columns={columns}
          rows={rows}
          total={list.total}
          noun="order"
          hasMore={list.hasMore}
          loading={list.loading}
          error={list.error}
          onLoadMore={list.loadMore}
          onRetry={list.retry}
          dimmed={pending}
          minWidth="76rem"
          estimateRowHeight={65}
          empty={
            filtering
              ? t('No order matches these filters.')
              : t('No orders yet. When someone buys something from your store, it will appear here.')
          }
        />

        <OrderDetail
          row={viewing.row}
          open={viewing.open}
          onOpenChange={changeOpen}
          canUpdate={canUpdate}
          moves={
            canUpdate
              ? {
                  allowed: (status) => (status !== 'cancelled' && status !== 'failed') || canCancel,
                  label: (status) => t(MOVE_LABEL[status]),
                  busy,
                  run: (status) => (viewing.row ? moveOne(viewing.row, status) : Promise.resolve(false)),
                }
              : undefined
          }
        />
      </div>
    </TooltipProvider>
  );
}
