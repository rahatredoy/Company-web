'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Check, Clock, FileText, ImageOff, Mail, Phone, X, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { titleCase } from '@/lib/format';
import { useT, type MessageKey, type Translator } from '@/lib/i18n';
import type { ReturnRow, ReturnStatus, ReturnView } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  DetailCard,
  DetailColumns,
  DetailFactList,
  DetailId,
  DetailSheet,
  DetailStat,
  DetailTable,
  DetailTotals,
  keepFacts,
} from './detail-sheet';
import { LazyImage } from './lazy-image';
import { ReturnWorkflow } from './return-workflow';

/** Bytes as the reader thinks of them, for an attachment's size column. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const RETURN_STATUS_LABEL: Record<ReturnStatus, MessageKey> = {
  requested: 'Requested',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  received: 'Received',
  inspected: 'Inspected',
  completed: 'Completed',
};

/** A return status as a word; one the panel does not know yet is shown as it came. */
function returnStatusLabel(t: Translator, status: string): string {
  const key = RETURN_STATUS_LABEL[status as ReturnStatus] as MessageKey | undefined;
  return key ? t(key) : t.loose(titleCase(status));
}

/**
 * One return request, laid out in the order an owner decides it — the same
 * shape as the order panel, so the two read alike.
 *
 * It used to print every column as a two-column list, which put "Record
 * updated" at the weight of the refundable amount and pushed the lines — the
 * thing actually being decided — below the fold. Now, top to bottom:
 *
 * 1. **Progress** — requested, under review, approved, received, inspected,
 *    completed, each dated. A rejected return stops where it was refused and
 *    says why.
 * 2. **Three figures** — what is refundable, how many items are coming back,
 *    and what the customer asked for.
 * 3. **The customer's case** — their reason, their words and their photos.
 * 4. **Customer beside the order** it is a return against.
 * 5. **Items** with the inspection per line and the refundable total under
 *    them. Only a line inspected as `good` goes back on sale, so
 *    `restockedQuantity` stays per line rather than summarised.
 * 6. **Refunds beside the staff note**, each drawn only when there is something
 *    in it — completing a return *raises* a refund, and settling it is a
 *    separate act, so the return row alone never says the money went back.
 * 7. **History beside the record** — ids and timestamps, for the day somebody
 *    needs them.
 *
 * Nothing the API returns was dropped; the columns nobody acts on moved to the
 * last card instead of the first.
 *
 * **A return has no screen of its own.** Reviewing, rejecting, inspecting and
 * completing are the footer's buttons (`ReturnWorkflow`), and every other screen
 * links to a return as `/returns?view=<id>`.
 */
export function ReturnDetail({
  row,
  open,
  onOpenChange,
  canApprove = false,
}: {
  row: ReturnRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the review, inspection and completion buttons are offered in the footer. */
  canApprove?: boolean;
}) {
  const t = useT();
  const detail = useDetail<ReturnView>({
    path: '/api/v1/admin/returns',
    id: row?.id ?? null,
    enabled: open,
  });

  const entry = detail.data;
  const currency = entry?.currency ?? row?.currency ?? 'USD';

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="font-mono">{entry?.returnNumber ?? row?.returnNumber ?? t('Return')}</span>}
      subtitle={entry ? `${entry.customerName} · ${t.loose(titleCase(entry.reason))}` : row?.customerName}
      badge={
        <>
          <StatusBadge status={entry?.status ?? row?.status ?? 'requested'} />
          {entry ? <StatusBadge status={entry.resolution} /> : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        entry && canApprove ? (
          <ReturnWorkflow key={entry.id} detail={entry} canApprove={canApprove} onMoved={detail.reload} />
        ) : null
      }
    >
      {entry ? <ReturnBody entry={entry} currency={currency} /> : null}
    </DetailSheet>
  );
}

function ReturnBody({ entry, currency }: { entry: ReturnView; currency: string }) {
  const t = useT();
  const money = (value: string | number | null | undefined) => t.money(value, currency);
  const rejected = entry.status === 'rejected';

  const units = entry.items.reduce((sum, item) => sum + item.quantity, 0);
  const restocked = entry.items.reduce((sum, item) => sum + item.restockedQuantity, 0);
  const inspected = entry.items.some((item) => item.inspectionResult);
  const lineValue = entry.items.reduce((sum, item) => sum + Number(item.lineTotal), 0);
  const orderRefunded = Number(entry.orderRefundedTotal);

  // ------------------------------------------------------------- figures --

  const figures = (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <DetailStat
        label={t('Refundable')}
        value={money(entry.refundableAmount)}
        tone={rejected ? 'muted' : 'default'}
        sub={t('Order total {amount}', { amount: money(entry.orderTotal) })}
      />
      <DetailStat
        label={t('Items')}
        value={t.number(units)}
        sub={[
          t.plural(entry.items.length, '{count} product', '{count} products'),
          inspected ? t('{count} restocked', { count: restocked }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <DetailStat
        label={t('Asked for')}
        value={t.loose(titleCase(entry.resolution))}
        sub={t.loose(titleCase(entry.reason))}
      />
    </div>
  );

  // --------------------------------------------------------------- facts --

  const orderFacts = keepFacts([
    {
      label: t('Order'),
      value: (
        <Link href={`/orders?view=${entry.orderId}`} className="font-mono text-[12px] hover:underline">
          {entry.orderNumber}
        </Link>
      ),
    },
    { label: t('Order status'), value: <StatusBadge status={entry.orderStatus} /> },
    { label: t('Order placed'), value: t.dateTime(entry.orderPlacedAt) },
    { label: t('Order total'), value: money(entry.orderTotal) },
    {
      label: t('Already refunded on it'),
      value: <span className={cn(orderRefunded > 0 && 'text-warning')}>{money(entry.orderRefundedTotal)}</span>,
    },
  ]);

  const recordFacts = keepFacts([
    { label: t('Return ID'), value: <DetailId value={entry.id} /> },
    entry.reviewedBy && { label: t('Reviewed by'), value: <DetailId value={entry.reviewedBy} /> },
    { label: t('Requested'), value: t.dateTime(entry.createdAt) },
    entry.reviewedAt && { label: t('Reviewed'), value: t.dateTime(entry.reviewedAt) },
    entry.receivedAt && { label: t('Received back'), value: t.dateTime(entry.receivedAt) },
    entry.completedAt && { label: t('Completed'), value: t.dateTime(entry.completedAt) },
    { label: t('Record updated'), value: t.dateTime(entry.updatedAt) },
  ]);

  return (
    <div className="space-y-4">
      <DetailCard title={t('Progress')}>
        <ProgressStrip steps={progressOf(entry, t)} />
        {rejected ? (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm">
            <span className="font-medium text-destructive">{t('Rejection reason')}: </span>
            {entry.rejectionReason || t('None given.')}
          </div>
        ) : null}
      </DetailCard>

      {figures}

      <DetailCard title={t('What the customer said')}>
        <div className="space-y-3">
          <p className="text-sm font-medium">{t.loose(titleCase(entry.reason))}</p>
          {entry.description ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm whitespace-pre-wrap">
              {entry.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Nothing beyond the reason.')}</p>
          )}
          {entry.attachments.length > 0 ? (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t('Evidence')} · {t.number(entry.attachments.length)}
              </p>
              <div className="flex flex-wrap gap-2">
                {entry.attachments.map((file) => (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="space-y-1"
                    // i18n-ignore — a MIME type and a size in units, not language
                    title={`${file.mimeType} · ${formatBytes(file.sizeBytes)}`}
                  >
                    <LazyImage
                      src={file.mimeType.startsWith('image/') ? file.url : null}
                      alt=""
                      className="size-32 rounded-md border border-border bg-muted"
                      fallback={<FileText className="size-5 text-muted-foreground" />}
                    />
                    <span className="block text-center text-[10.5px] text-muted-foreground">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DetailCard>

      <DetailColumns>
        <DetailCard
          title={t('Customer')}
          action={
            entry.customerId ? (
              <Badge variant="info">{t('Account')}</Badge>
            ) : (
              <Badge variant="neutral">{t('Guest')}</Badge>
            )
          }
        >
          <div className="space-y-2 text-sm">
            <p className="font-medium break-words">
              {entry.customerId ? (
                <Link href={`/customers?view=${entry.customerId}`} className="hover:underline">
                  {entry.customerName}
                </Link>
              ) : (
                entry.customerName
              )}
            </p>
            {entry.email ? (
              <IconLine icon={Mail}>
                <a href={`mailto:${entry.email}`} className="break-all hover:underline">
                  {entry.email}
                </a>
              </IconLine>
            ) : null}
            {entry.phone ? (
              <IconLine icon={Phone}>
                <a href={`tel:${entry.phone}`} className="hover:underline">
                  {entry.phone}
                </a>
              </IconLine>
            ) : null}
            {entry.customerId ? null : (
              <p className="text-xs text-muted-foreground">{t('Guest checkout — no account.')}</p>
            )}
          </div>
        </DetailCard>
        <DetailCard title={t('Order')}>
          <DetailFactList facts={orderFacts} />
        </DetailCard>
      </DetailColumns>

      <DetailCard
        title={t('Items')}
        action={<span className="text-xs text-muted-foreground">{t.number(entry.items.length)}</span>}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {t('Only a line inspected as good goes back on sale; the rest is recorded as damaged.')}
        </p>
        <DetailTable
          rows={entry.items}
          rowKey={(item) => item.id}
          empty={t('No line on this return.')}
          columns={[
            {
              key: 'product',
              header: t('Product'),
              cell: (item) => (
                <div className="flex items-center gap-2.5">
                  <LazyImage
                    src={item.imageUrl}
                    alt=""
                    className="size-10 rounded border border-border bg-muted"
                    fallback={<ImageOff className="size-4 text-muted-foreground" />}
                  />
                  <div className="min-w-0">
                    {item.productId ? (
                      <Link href={`/products/${item.productId}`} className="block truncate font-medium hover:underline">
                        {item.productName}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium">{item.productName}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {[item.variantTitle, item.sku].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                </div>
              ),
            },
            {
              key: 'qty',
              header: t('Returning'),
              align: 'right',
              cell: (item) => t('{quantity} of {ordered}', { quantity: item.quantity, ordered: item.orderedQuantity }),
            },
            {
              key: 'inspection',
              header: t('Inspection'),
              cell: (item) =>
                item.inspectionResult ? (
                  <div className="space-y-1">
                    <StatusBadge status={item.inspectionResult} />
                    {item.inspectionNote ? (
                      <span className="block text-xs text-muted-foreground">{item.inspectionNote}</span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('Not inspected')}</span>
                ),
            },
            {
              key: 'restocked',
              header: t('Restocked'),
              align: 'right',
              cell: (item) =>
                item.restockedQuantity > 0 ? (
                  <span className="text-success">{t.number(item.restockedQuantity)}</span>
                ) : (
                  <span className="text-muted-foreground">{t.number(0)}</span>
                ),
            },
            {
              key: 'total',
              header: t('Value'),
              align: 'right',
              cell: (item) => <span className="font-medium">{money(item.lineTotal)}</span>,
            },
          ]}
        />

        <DetailTotals
          className="mt-3 ml-auto max-w-sm border-0 p-0"
          rows={[
            { label: t('Value'), value: money(lineValue), muted: true },
            { label: t('Refundable'), value: money(entry.refundableAmount), strong: true },
          ]}
        />
      </DetailCard>

      {entry.refunds.length > 0 || entry.adminNote ? (
        <DetailColumns>
          {entry.refunds.length > 0 ? (
            <DetailCard
              title={t('Refunds raised')}
              action={<span className="text-xs text-muted-foreground">{t.number(entry.refunds.length)}</span>}
            >
              <div className="space-y-2">
                {entry.refunds.map((refund) => (
                  <div key={refund.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-[12px] font-medium">{refund.refundNumber}</span>
                      <StatusBadge status={refund.status} />
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 break-words text-muted-foreground">
                        {[
                          refund.method && t.loose(titleCase(refund.method)),
                          refund.completedAt
                            ? `${t('Settled')} ${t.date(refund.completedAt)}`
                            : `${t('Raised')} ${t.date(refund.createdAt)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {t.money(refund.amount, refund.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </DetailCard>
          ) : null}
          {entry.adminNote ? (
            <DetailCard title={t('Staff note')}>
              <p className="text-sm whitespace-pre-wrap">{entry.adminNote}</p>
            </DetailCard>
          ) : null}
        </DetailColumns>
      ) : null}

      <DetailColumns>
        <DetailCard
          title={t('History')}
          action={<span className="text-xs text-muted-foreground">{t.number(entry.history.length)}</span>}
        >
          <HistoryTimeline history={entry.history} />
        </DetailCard>
        <DetailCard title={t('Record')}>
          <DetailFactList facts={recordFacts} />
        </DetailCard>
      </DetailColumns>
    </div>
  );
}

// ------------------------------------------------------------- progress --

type StepState = 'done' | 'next' | 'waiting' | 'stopped';

interface Step {
  key: string;
  label: string;
  state: StepState;
  at: string | null;
}

/** How far along the path each status is — the index of the last step it has passed. */
const STATUS_RANK: Record<string, number> = {
  requested: 0,
  under_review: 1,
  approved: 2,
  received: 3,
  inspected: 4,
  completed: 5,
};

/**
 * The dates come from the return's own stage timestamps where it has one and
 * from the status history where it does not — "under review" and "inspected"
 * have no column. A rejected return shows only the steps it reached, then where
 * it stopped: the rest of the path is not "waiting" and drawing it would say so.
 */
function progressOf(entry: ReturnView, t: Translator): Step[] {
  const reachedAt = (status: string) =>
    entry.history
      .filter((item) => item.toStatus === status)
      .map((item) => item.createdAt)
      .sort()[0] ?? null;

  const flow: Omit<Step, 'state'>[] = [
    { key: 'requested', label: t('Requested'), at: entry.createdAt },
    { key: 'under_review', label: t('Under Review'), at: reachedAt('under_review') },
    { key: 'approved', label: t('Approved'), at: reachedAt('approved') ?? (entry.status !== 'rejected' ? entry.reviewedAt : null) },
    { key: 'received', label: t('Received'), at: entry.receivedAt ?? reachedAt('received') },
    { key: 'inspected', label: t('Inspected'), at: reachedAt('inspected') },
    { key: 'completed', label: t('Completed'), at: entry.completedAt ?? reachedAt('completed') },
  ];

  if (entry.status === 'rejected') {
    const reached = flow.reduce((last, step, index) => (step.at ? index : last), 0);
    return [
      ...flow.slice(0, reached + 1).map((step) => ({ ...step, state: 'done' as const })),
      {
        key: 'rejected',
        label: t('Rejected'),
        state: 'stopped',
        at: entry.reviewedAt ?? reachedAt('rejected'),
      },
    ];
  }

  const rank = STATUS_RANK[entry.status] ?? 0;
  return flow.map((step, index) => ({
    ...step,
    state: index <= rank ? 'done' : index === rank + 1 ? 'next' : 'waiting',
  }));
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
  stopped: 'bg-destructive',
  next: 'bg-primary/40',
  waiting: 'bg-border',
};

const STEP_TEXT: Record<StepState, string> = {
  done: 'text-foreground',
  stopped: 'text-destructive',
  next: 'text-foreground',
  waiting: 'text-muted-foreground',
};

function ProgressStrip({ steps }: { steps: Step[] }) {
  const t = useT();

  return (
    <ol className={cn('grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3', STEP_COLUMNS[steps.length])}>
      {steps.map((step) => {
        const Icon = step.state === 'stopped' ? X : step.state === 'done' ? Check : Clock;
        return (
          <li key={step.key} className="min-w-0">
            <div className={cn('h-1.5 rounded-full', STEP_BAR[step.state])} aria-hidden />
            <p className={cn('mt-2 flex items-center gap-1.5 text-sm font-medium', STEP_TEXT[step.state])}>
              <Icon className={cn('size-3.5 shrink-0', step.state === 'next' && 'text-primary')} aria-hidden />
              <span className="truncate">{step.label}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {step.at
                ? t.dateTime(step.at)
                : step.state === 'next'
                  ? t('Up next')
                  : step.state === 'waiting'
                    ? t('Not yet')
                    : t('Done')}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- pieces --

/** Newest first, as the API sends it — the last thing that happened is what is asked. */
function HistoryTimeline({ history }: { history: ReturnView['history'] }) {
  const t = useT();
  if (history.length === 0) return <p className="text-sm text-muted-foreground">{t('No move recorded.')}</p>;

  return (
    <ol className="space-y-3">
      {history.map((item, index) => (
        <li key={item.id} className="relative flex gap-3">
          {index < history.length - 1 ? (
            <span className="absolute top-4 -bottom-3 left-[3.5px] w-px bg-border" aria-hidden />
          ) : null}
          <span
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground/40')}
            aria-hidden
          />
          <div className="min-w-0 text-sm">
            <p>
              <span className="font-medium">{returnStatusLabel(t, item.toStatus)}</span>
              {item.fromStatus ? (
                <span className="text-muted-foreground">
                  {' · '}
                  {t('from {status}', { status: returnStatusLabel(t, item.fromStatus) })}
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.dateTime(item.createdAt)} · {item.adminLabel ?? t('System')}
            </p>
            {item.note ? <p className="mt-0.5 text-xs break-words">{item.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
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
