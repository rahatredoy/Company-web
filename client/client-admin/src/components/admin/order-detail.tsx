'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Clock, ImageOff, Mail, MapPin, Phone, X, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge, statusLabel, statusVariant } from '@/components/ui/status-badge';
import { Alert } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useDetail } from '@/hooks/use-detail';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import type { OrderAddressRow, OrderRow, OrderStatus, OrderView } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  DetailBool,
  DetailCard,
  DetailColumns,
  DetailFactList,
  DetailId,
  DetailJson,
  DetailSheet,
  DetailStat,
  DetailTable,
  DetailTotals,
  keepFacts,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * One order, laid out in the order an owner asks about it.
 *
 * It used to print every column as a two-column list of label and value, which
 * put "Record updated" at the same weight as the total and made the reader hunt
 * for where the parcel was going. Now, top to bottom:
 *
 * 1. **Progress** — placed, confirmed, packed, shipped, delivered, as a strip,
 *    each step with the moment it happened. A cancelled order stops at the step
 *    it reached and says why, and whether its stock went back on sale.
 * 2. **Three figures** — the total, how many items, where payment stands.
 * 3. **Who and where**, side by side — the customer, the delivery address, and
 *    the billing address only when it differs.
 * 4. **Items** with the totals under them, the way an invoice reads.
 * 5. **Payment**, then returns beside refunds and the two notes beside each
 *    other, each drawn only when there is something in it.
 * 6. **History beside the record** — the ids, the IP, the timestamps and the
 *    `metadata` blob, folded, for the day somebody needs them.
 *
 * Nothing the API returns was dropped: every column is still somewhere, but the
 * ones nobody acts on sit in the last card instead of the first.
 *
 * **`inventory_released` is worth saying out loud on a cancelled order.** It is
 * the difference between stock that is back on the shelf and stock still
 * committed to a sale that will never happen, and nothing else says which.
 */
/**
 * The status moves the panel offers, handed in by the list so a move made here
 * is the very same write — the cancel-reason prompt, the toast, the list refresh
 * — as one made from the row's menu. Absent when the admin may not update orders.
 */
export interface OrderMoves {
  /** Whether this admin may make this move — cancelling needs its own permission. */
  allowed: (status: OrderStatus) => boolean;
  label: (status: OrderStatus) => string;
  busy: boolean;
  /** Resolves true when the order actually moved. */
  run: (status: OrderStatus) => Promise<boolean>;
}

/*
 * Moving an order along is the one write this panel makes, at the owner's
 * request: confirming a morning's orders one by one should not mean opening
 * each on its own screen. The buttons come from `allowedTransitions` on the
 * record just read (the row's copy until it lands), and the API re-checks the
 * same map, so a stale panel gets a clear refusal rather than a bad write.
 */
export function OrderDetail({
  row,
  open,
  onOpenChange,
  moves,
  canUpdate = false,
}: {
  row: OrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moves?: OrderMoves;
  /** Whether the staff note can be written from the panel. */
  canUpdate?: boolean;
}) {
  const detail = useDetail<OrderView>({
    path: '/api/v1/admin/orders',
    id: row?.id ?? null,
    enabled: open,
  });

  const order = detail.data;
  const currency = order?.currency ?? row?.currency ?? 'USD';

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="font-mono">{order?.orderNumber ?? row?.orderNumber ?? 'Order'}</span>}
      subtitle={
        order ? `${order.customerName} · placed ${formatDateTime(order.placedAt)}` : row?.customerName
      }
      badge={
        <>
          <StatusBadge status={order?.status ?? row?.status ?? 'new'} />
          <StatusBadge status={order?.paymentStatus ?? row?.paymentStatus ?? 'pending'} />
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row && moves ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            {(order?.allowedTransitions ?? row.allowedTransitions)
                  .filter(moves.allowed)
                  .map((status) => {
                    const stopping = status === 'cancelled' || status === 'failed';
                    return (
                      <Button
                        key={status}
                        size="sm"
                        variant={stopping ? 'outline' : 'primary'}
                        className={cn(stopping && 'text-destructive')}
                        disabled={moves.busy}
                        onClick={async () => {
                          if (await moves.run(status)) detail.reload();
                        }}
                      >
                        {moves.label(status)}
                      </Button>
                    );
                  })}
          </div>
        ) : null
      }
    >
      {order ? (
        <OrderBody order={order} currency={currency} canUpdate={canUpdate} onNoteSaved={detail.reload} />
      ) : null}
    </DetailSheet>
  );
}

function OrderBody({
  order,
  currency,
  canUpdate,
  onNoteSaved,
}: {
  order: OrderView;
  currency: string;
  canUpdate: boolean;
  onNoteSaved: () => void;
}) {
  const money = (value: string | number | null | undefined) => formatMoney(value, currency);
  const stopped = order.status === 'cancelled' || order.status === 'failed';

  const shipping = order.addresses.find((address) => address.type === 'shipping');
  const billing = order.addresses.find((address) => address.type === 'billing');
  const billingSame = Boolean(shipping && billing && sameAddress(shipping, billing));

  const units = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const returnedUnits = order.lines.reduce((sum, line) => sum + line.returnedQuantity, 0);
  const refunded = Number(order.refundedTotal);
  const discount = Number(order.discountTotal);

  // ------------------------------------------------------------- figures --

  const figures = (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <DetailStat
        label="Order total"
        value={money(order.grandTotal)}
        tone={stopped ? 'muted' : 'default'}
        sub={
          refunded > 0
            ? `${money(refunded)} refunded`
            : discount > 0
              ? `After ${money(discount)} discount`
              : null
        }
      />
      <DetailStat
        label="Items"
        value={formatNumber(units)}
        sub={`${order.lines.length} ${order.lines.length === 1 ? 'product' : 'products'}${
          returnedUnits > 0 ? ` · ${formatNumber(returnedUnits)} returned` : ''
        }`}
      />
      <DetailStat
        label="Payment"
        value={statusLabel(order.paymentStatus)}
        tone={stopped && order.paymentStatus === 'cod_pending' ? 'muted' : toneOf(order.paymentStatus)}
        sub={
          order.paymentStatus === 'cod_pending'
            ? stopped
              ? 'Nothing to collect'
              : `Collect ${money(order.grandTotal)} on delivery`
            : (order.paymentMethodLabel ?? (order.paymentProvider ? providerLabel(order.paymentProvider) : null))
        }
      />
    </div>
  );

  // --------------------------------------------------------------- cards --

  const paymentFacts = keepFacts([
    { label: 'Status', value: <StatusBadge status={order.paymentStatus} /> },
    { label: 'Method', value: order.paymentMethodLabel },
    // "Cash on delivery" under "Cash on Delivery" says one thing twice.
    order.paymentProvider &&
      providerLabel(order.paymentProvider).toLowerCase() !== (order.paymentMethodLabel ?? '').toLowerCase() && {
        label: 'Provider',
        value: providerLabel(order.paymentProvider),
      },
    order.couponCode && { label: 'Coupon', value: order.couponCode, mono: true },
  ]);

  const recordFacts = keepFacts([
    { label: 'Order ID', value: <DetailId value={order.id} /> },
    order.customerId && { label: 'Account ID', value: <DetailId value={order.customerId} /> },
    order.couponId && { label: 'Coupon ID', value: <DetailId value={order.couponId} /> },
    { label: 'Placed from', value: order.ipAddress, mono: true },
    {
      label: 'Stock released',
      value: <DetailBool value={order.inventoryReleased} />,
      hint: stopped ? (order.inventoryReleased ? 'Back on sale' : 'Still held for this order') : undefined,
    },
    { label: 'Created', value: formatDateTime(order.createdAt) },
    { label: 'Last updated', value: formatDateTime(order.updatedAt) },
  ]);
  const hasMetadata = Boolean(order.metadata && Object.keys(order.metadata).length > 0);

  return (
    <div className="space-y-4">
      <DetailCard title="Progress">
        <ProgressStrip steps={progressOf(order)} />
        {stopped ? (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm">
            <p>
              <span className="font-medium text-destructive">Reason: </span>
              {order.cancelReason || 'None given'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {order.inventoryReleased
                ? 'The stock this order reserved is back on sale.'
                : 'The stock this order reserved is still held.'}
            </p>
          </div>
        ) : null}
      </DetailCard>

      {figures}

      <DetailColumns>
        <DetailCard
          title="Customer"
          action={
            order.customer ? <Badge variant="info">Account</Badge> : <Badge variant="neutral">Guest</Badge>
          }
        >
          <div className="space-y-2 text-sm">
            <p className="font-medium break-words">
              {order.customer ? (
                <Link href={`/customers?view=${order.customer.id}`} className="hover:underline">
                  {order.customerName}
                </Link>
              ) : (
                order.customerName
              )}
            </p>
            {order.email ? (
              <IconLine icon={Mail}>
                <a href={`mailto:${order.email}`} className="break-all hover:underline">
                  {order.email}
                </a>
              </IconLine>
            ) : null}
            {order.phone ? (
              <IconLine icon={Phone}>
                <a href={`tel:${order.phone}`} className="hover:underline">
                  {order.phone}
                </a>
              </IconLine>
            ) : null}
            {order.customer ? null : (
              <p className="text-xs text-muted-foreground">Ordered without an account.</p>
            )}
          </div>
        </DetailCard>
        <DetailCard title="Delivery address">
          <AddressBlock
            address={shipping}
            note={billingSame ? 'Billing address is the same.' : undefined}
          />
        </DetailCard>
        {billing && !billingSame ? (
          <DetailCard title="Billing address">
            <AddressBlock address={billing} />
          </DetailCard>
        ) : null}
      </DetailColumns>

      <DetailCard
        title="Items"
        action={<span className="text-xs text-muted-foreground">{order.lines.length}</span>}
      >
        <DetailTable
          rows={order.lines}
          rowKey={(line) => line.id}
          empty="This order has no lines."
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (line) => (
                <div className="flex items-center gap-2.5">
                  <LazyImage
                    src={line.imageUrl}
                    alt=""
                    className="size-10 rounded border border-border bg-muted"
                    fallback={<ImageOff className="size-4 text-muted-foreground" />}
                  />
                  <div className="min-w-0">
                    {line.productId ? (
                      <Link href={`/products/${line.productId}`} className="block truncate font-medium hover:underline">
                        {line.productName}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium">{line.productName}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {[line.measureLabel ?? line.variantTitle, line.sku].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                </div>
              ),
            },
            {
              key: 'qty',
              header: 'Qty',
              align: 'right',
              // What to weigh out, not just how many — see the order screen.
              cell: (line) => (
                <>
                  {line.quantity}
                  {line.measureLabel ? (
                    <span className="block text-xs text-muted-foreground">&times; {line.measureLabel}</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'unit',
              header: 'Unit price',
              align: 'right',
              cell: (line) => {
                const sale = line.unitSalePrice !== null && Number(line.unitSalePrice) < Number(line.unitPrice);
                return (
                  <>
                    {money(sale ? line.unitSalePrice : line.unitPrice)}
                    {sale ? <s className="block text-xs text-muted-foreground">{money(line.unitPrice)}</s> : null}
                  </>
                );
              },
            },
            ...(returnedUnits > 0
              ? [
                  {
                    key: 'returned',
                    header: 'Returned',
                    align: 'right' as const,
                    cell: (line: OrderView['lines'][number]) =>
                      line.returnedQuantity > 0 ? (
                        <span className="text-warning">{line.returnedQuantity}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                ]
              : []),
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              cell: (line) => <span className="font-medium">{money(line.lineTotal)}</span>,
            },
          ]}
        />

        <DetailTotals
          className="mt-3 ml-auto max-w-sm border-0 p-0"
          rows={[
            { label: 'Subtotal', value: money(order.subtotal) },
            ...(discount > 0
              ? [
                  {
                    label: order.couponCode ? `Discount (${order.couponCode})` : 'Discount',
                    value: <span className="text-success">−{money(order.discountTotal)}</span>,
                  },
                ]
              : []),
            ...(Number(order.taxTotal) > 0 ? [{ label: 'Tax', value: money(order.taxTotal) }] : []),
            { label: 'Total', value: money(order.grandTotal), strong: true },
            ...(refunded > 0
              ? [{ label: 'Refunded so far', value: `−${money(order.refundedTotal)}`, muted: true }]
              : []),
          ]}
        />
      </DetailCard>

      <DetailColumns>
        <DetailCard title="Payment">
          <DetailFactList facts={paymentFacts} />
          <SubList title="Transactions" empty="No payment attempt recorded.">
            {order.payments.map((payment) => (
              <RecordRow
                key={payment.id}
                title={providerLabel(payment.provider)}
                badge={<StatusBadge status={payment.status} />}
                left={payment.paidAt ? `Paid ${formatDateTime(payment.paidAt)}` : `Started ${formatDateTime(payment.createdAt)}`}
                right={
                  <>
                    {formatMoney(payment.amount, payment.currency)}
                    {Number(payment.refundedAmount) > 0 ? (
                      <span className="block text-muted-foreground">
                        −{formatMoney(payment.refundedAmount, payment.currency)} refunded
                      </span>
                    ) : null}
                  </>
                }
              >
                {payment.providerReference ? (
                  <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                    Ref {payment.providerReference}
                  </p>
                ) : null}
                {payment.failureReason ? (
                  <p className="mt-1 text-xs text-destructive">{payment.failureReason}</p>
                ) : null}
              </RecordRow>
            ))}
          </SubList>
        </DetailCard>
      </DetailColumns>

      {order.returns.length > 0 || order.refunds.length > 0 ? (
        <DetailColumns>
          {order.returns.length > 0 ? (
            <DetailCard
              title="Returns"
              action={<span className="text-xs text-muted-foreground">{order.returns.length}</span>}
            >
              <div className="space-y-2">
                {order.returns.map((entry) => (
                  <RecordRow
                    key={entry.id}
                    title={
                      <Link href={`/returns?view=${entry.id}`} className="font-mono text-[12px] hover:underline">
                        {entry.returnNumber}
                      </Link>
                    }
                    badge={<StatusBadge status={entry.status} />}
                    left={`${titleCase(entry.reason)} · wants ${titleCase(entry.resolution).toLowerCase()} · ${formatDate(entry.createdAt)}`}
                    right={money(entry.refundableAmount)}
                  />
                ))}
              </div>
            </DetailCard>
          ) : null}
          {order.refunds.length > 0 ? (
            <DetailCard
              title="Refunds"
              action={<span className="text-xs text-muted-foreground">{order.refunds.length}</span>}
            >
              <div className="space-y-2">
                {order.refunds.map((refund) => (
                  <RecordRow
                    key={refund.id}
                    title={<span className="font-mono text-[12px]">{refund.refundNumber}</span>}
                    badge={<StatusBadge status={refund.status} />}
                    left={[
                      refund.method && titleCase(refund.method),
                      refund.completedAt
                        ? `Settled ${formatDate(refund.completedAt)}`
                        : `Raised ${formatDate(refund.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={formatMoney(refund.amount, refund.currency)}
                  >
                    {refund.reason ? <p className="mt-1 text-xs text-muted-foreground">{refund.reason}</p> : null}
                  </RecordRow>
                ))}
              </div>
            </DetailCard>
          ) : null}
        </DetailColumns>
      ) : null}

      {order.customerNote || order.adminNote || canUpdate ? (
        <DetailColumns>
          {order.customerNote ? (
            <DetailCard title="Note from the customer">
              <p className="text-sm whitespace-pre-wrap">{order.customerNote}</p>
            </DetailCard>
          ) : null}
          {canUpdate ? (
            <StaffNote key={order.id} orderId={order.id} note={order.adminNote} onSaved={onNoteSaved} />
          ) : order.adminNote ? (
            <DetailCard title="Staff note">
              <p className="text-sm whitespace-pre-wrap">{order.adminNote}</p>
            </DetailCard>
          ) : null}
        </DetailColumns>
      ) : null}

      <DetailColumns>
        <DetailCard
          title="History"
          action={<span className="text-xs text-muted-foreground">{order.history.length}</span>}
        >
          <HistoryTimeline history={order.history} />
        </DetailCard>

        <DetailCard title="Record">
          <DetailFactList facts={recordFacts} />
          {hasMetadata ? (
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Checkout data
              </summary>
              <div className="mt-2">
                <DetailJson value={order.metadata} />
              </div>
            </details>
          ) : null}
        </DetailCard>
      </DetailColumns>
    </div>
  );
}

// ----------------------------------------------------------- staff note --

/**
 * The staff note, written from the panel.
 *
 * Never returned by any storefront endpoint, which is what makes it usable for
 * what actually needs writing down — "customer phoned, leave it with the
 * neighbour". The customer's own note sits beside it and is not editable, so
 * internal wording never lands in front of whoever placed the order.
 */
function StaffNote({ orderId, note, onSaved }: { orderId: string; note: string | null; onSaved: () => void }) {
  const [value, setValue] = React.useState(note ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const dirty = value !== (note ?? '');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/v1/admin/orders/${orderId}/note`, { adminNote: value.trim() || null });
      toast.success('Note saved.');
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailCard title="Staff note">
      <div className="space-y-2">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Only ever seen here — never by the customer."
          aria-label="Staff note"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save note
          </Button>
        </div>
      </div>
    </DetailCard>
  );
}

// ------------------------------------------------------------- progress --

type StepState = 'done' | 'next' | 'waiting' | 'stopped' | 'after';

interface Step {
  key: string;
  label: string;
  state: StepState;
  at: string | null;
  note?: string;
}

/** How far along the path each status is — the index of the last step it has passed. */
const STATUS_RANK: Record<string, number> = {
  new: 0,
  pending: 0,
  confirmed: 1,
  processing: 1,
  packed: 2,
  shipped: 3,
  out_for_delivery: 3,
  delivered: 4,
  returned: 4,
  refunded: 4,
};

/**
 * The strip across the top of the panel.
 *
 * The dates come from the order's own stage timestamps where it has one, and
 * from the status history where it does not — "packed" has no column, and an
 * order that skipped a step through an older build has no timestamp for it.
 * A step that was passed with neither still reads as done, without a date,
 * rather than as waiting for something that already happened.
 *
 * A cancelled or failed order shows only the steps it reached, then where it
 * stopped: the rest of the path is not "waiting" and drawing it would say so.
 */
function progressOf(order: OrderView): Step[] {
  const reachedAt = (statuses: string[]) =>
    order.history
      .filter((entry) => statuses.includes(entry.toStatus))
      .map((entry) => entry.createdAt)
      .sort()[0] ?? null;

  const flow: Omit<Step, 'state'>[] = [
    { key: 'placed', label: 'Placed', at: order.placedAt },
    { key: 'confirmed', label: 'Confirmed', at: order.confirmedAt ?? reachedAt(['confirmed']) },
    { key: 'packed', label: 'Packed', at: reachedAt(['packed']) },
    { key: 'shipped', label: 'Shipped', at: order.shippedAt ?? reachedAt(['shipped', 'out_for_delivery']) },
    { key: 'delivered', label: 'Delivered', at: order.deliveredAt ?? reachedAt(['delivered']) },
  ];

  if (order.status === 'cancelled' || order.status === 'failed') {
    const reached = flow.reduce((last, step, index) => (step.at ? index : last), 0);
    return [
      ...flow.slice(0, reached + 1).map((step) => ({ ...step, state: 'done' as const })),
      {
        key: order.status,
        label: statusLabel(order.status),
        state: 'stopped',
        at: order.cancelledAt ?? reachedAt([order.status]),
      },
    ];
  }

  const rank = STATUS_RANK[order.status] ?? 0;
  const steps: Step[] = flow.map((step, index) => ({
    ...step,
    state: index <= rank ? 'done' : index === rank + 1 ? 'next' : 'waiting',
    note:
      index === rank + 1
        ? order.status === 'processing'
          ? 'Being packed'
          : order.status === 'out_for_delivery'
            ? 'Out for delivery'
            : 'Up next'
        : undefined,
  }));

  if (order.status === 'returned' || order.status === 'refunded') {
    steps.push({ key: 'returned', label: 'Returned', state: 'after', at: reachedAt(['returned']) });
  }
  if (order.status === 'refunded') {
    steps.push({ key: 'refunded', label: 'Refunded', state: 'after', at: reachedAt(['refunded']) });
  }
  return steps;
}

// Written out whole so Tailwind sees every class it has to generate.
const STEP_COLUMNS: Record<number, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
  7: 'md:grid-cols-7',
};

const STEP_BAR: Record<StepState, string> = {
  done: 'bg-success',
  after: 'bg-warning',
  stopped: 'bg-destructive',
  next: 'bg-primary/40',
  waiting: 'bg-border',
};

const STEP_TEXT: Record<StepState, string> = {
  done: 'text-foreground',
  after: 'text-warning',
  stopped: 'text-destructive',
  next: 'text-foreground',
  waiting: 'text-muted-foreground',
};

function ProgressStrip({ steps }: { steps: Step[] }) {
  return (
    <ol className={cn('grid grid-cols-2 gap-x-3 gap-y-4', STEP_COLUMNS[steps.length])}>
      {steps.map((step) => {
        const Icon = step.state === 'stopped' ? X : step.state === 'done' || step.state === 'after' ? Check : Clock;
        return (
          <li key={step.key} className="min-w-0">
            <div className={cn('h-1.5 rounded-full', STEP_BAR[step.state])} aria-hidden />
            <p className={cn('mt-2 flex items-center gap-1.5 text-sm font-medium', STEP_TEXT[step.state])}>
              <Icon
                className={cn('size-3.5 shrink-0', step.state === 'next' && 'text-primary')}
                aria-hidden
              />
              <span className="truncate">{step.label}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {step.at ? formatDateTime(step.at) : (step.note ?? (step.state === 'waiting' ? 'Not yet' : 'Done'))}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- pieces --

/** Newest first, as the API sends it — the last thing that happened is what is asked. */
function HistoryTimeline({ history }: { history: OrderView['history'] }) {
  if (history.length === 0) return <p className="text-sm text-muted-foreground">No change recorded yet.</p>;

  return (
    <ol className="space-y-3">
      {history.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3">
          {index < history.length - 1 ? (
            <span className="absolute top-4 -bottom-3 left-[3.5px] w-px bg-border" aria-hidden />
          ) : null}
          <span
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground/40')}
            aria-hidden
          />
          <div className="min-w-0 text-sm">
            <p>
              <span className="font-medium">{statusLabel(entry.toStatus)}</span>
              {entry.fromStatus ? (
                <span className="text-muted-foreground"> · from {statusLabel(entry.fromStatus)}</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(entry.createdAt)} · {entry.adminLabel ?? 'System'}
            </p>
            {entry.note ? <p className="mt-0.5 text-xs break-words">{entry.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function AddressBlock({ address, note }: { address: OrderAddressRow | undefined; note?: string }) {
  if (!address) return <p className="text-sm text-muted-foreground">Not recorded.</p>;

  return (
    <address className="space-y-2 text-sm not-italic">
      <p className="font-medium break-words">{address.fullName}</p>
      <IconLine icon={MapPin}>
        <span className="text-muted-foreground">
          {address.addressLine1}
          {address.addressLine2 ? `, ${address.addressLine2}` : ''}
          <br />
          {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
          <br />
          {address.country}
        </span>
      </IconLine>
      {address.phone ? (
        <IconLine icon={Phone}>
          <a href={`tel:${address.phone}`} className="hover:underline">
            {address.phone}
          </a>
        </IconLine>
      ) : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </address>
  );
}

function IconLine({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** A labelled list of child rows inside a card — the payment transactions. */
function SubList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {children.length > 0 ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/** One payment, return or refund: what it is and its state, then when and how much. */
function RecordRow({
  title,
  badge,
  left,
  right,
  children,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        {badge}
      </div>
      {left || right ? (
        <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 break-words text-muted-foreground">{left}</span>
          {right ? <span className="shrink-0 text-right font-medium tabular-nums">{right}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// --------------------------------------------------------------- helpers --

/** `payment_provider` values, named the way an owner says them — `cod` is not a word. */
const PROVIDER_LABELS: Record<string, string> = {
  cod: 'Cash on delivery',
  mock: 'Test gateway',
  stripe: 'Stripe',
  sslcommerz: 'SSLCommerz',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? titleCase(provider);
}

function toneOf(status: string): 'default' | 'success' | 'warning' | 'danger' | 'muted' {
  const variant = statusVariant(status);
  if (variant === 'success' || variant === 'warning') return variant;
  if (variant === 'danger') return 'danger';
  if (variant === 'neutral') return 'muted';
  return 'default';
}

/** Billing is usually the delivery address copied, and printing it twice is noise. */
function sameAddress(a: OrderAddressRow, b: OrderAddressRow): boolean {
  const keys = ['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'] as const;
  return keys.every((key) => (a[key] ?? '').trim().toLowerCase() === (b[key] ?? '').trim().toLowerCase());
}
