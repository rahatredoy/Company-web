'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { Address, CartTotals, OrderDetail } from '@/types';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * The pieces an order is displayed with, shared between the confirmation page,
 * the account order page and the public tracking page.
 *
 * Written once because those three views must agree. Three copies of a totals
 * block is three chances for one of them to forget the discount line.
 *
 * A client module because the address book, itself a client component, draws
 * `AddressBlock` too — every prop here is plain data, so the server pages that
 * render these lose nothing by it.
 */

export function OrderLines({
  lines,
  currency,
  locale,
  className,
}: {
  lines: OrderDetail['lines'];
  currency: string;
  locale: string;
  className?: string;
}) {
  const t = useT();

  return (
    <ul className={cn('divide-y divide-border', className)}>
      {lines.map((line, index) => (
        <li key={`${line.productSlug ?? line.name}-${index}`} className="flex gap-3 py-3 first:pt-0">
          <span className="relative size-14 shrink-0 overflow-hidden rounded-(--radius-button) bg-surface-alt">
            {line.imageUrl ? (
              <Image src={line.imageUrl} alt="" aria-hidden fill sizes="56px" className="object-cover" />
            ) : null}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-snug">
              {line.productSlug ? (
                <Link href={`/product/${line.productSlug}`} className="hover:text-primary">
                  {line.name}
                </Link>
              ) : (
                line.name
              )}
            </span>

            {line.variantTitle ? (
              <span className="block text-xs text-subtle">{line.variantTitle}</span>
            ) : null}

            <span className="block text-xs text-muted">
              {t.number(line.quantity)} × {formatMoney(line.unitPrice, currency, locale)}
            </span>
          </span>

          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatMoney(line.lineTotal, currency, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OrderTotals({
  totals,
  locale,
  className,
}: {
  totals: CartTotals;
  locale: string;
  className?: string;
}) {
  const t = useT();
  const hasDiscount = Number.parseFloat(totals.discount) > 0;

  return (
    <dl className={cn('space-y-2 text-sm', className)}>
      <Row label={t('Subtotal')} value={formatMoney(totals.subtotal, totals.currency, locale)} />

      {hasDiscount ? (
        <Row
          label={t('Discount')}
          value={`− ${formatMoney(totals.discount, totals.currency, locale)}`}
          tone="success"
        />
      ) : null}

      {Number.parseFloat(totals.tax) > 0 ? (
        <Row label={t('Tax')} value={formatMoney(totals.tax, totals.currency, locale)} />
      ) : null}

      <div className="flex items-baseline justify-between border-t border-border pt-2.5">
        <dt className="font-semibold">{t('Total')}</dt>
        <dd className="text-lg font-bold tabular-nums">
          {formatMoney(totals.total, totals.currency, locale)}
        </dd>
      </div>
    </dl>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('tabular-nums', tone === 'success' && 'font-medium text-success')}>
        {value}
      </dd>
    </div>
  );
}

export function AddressBlock({
  address,
  className,
}: {
  address: Omit<Address, 'id' | 'isDefault' | 'label'> | null;
  className?: string;
}) {
  const t = useT();
  if (!address) return <p className={cn('text-sm text-subtle', className)}>{t('No address on file.')}</p>;

  return (
    <address className={cn('text-sm not-italic leading-relaxed text-muted', className)}>
      <span className="block font-medium text-foreground">{address.fullName}</span>
      <span className="block">{address.addressLine1}</span>
      {address.addressLine2 ? <span className="block">{address.addressLine2}</span> : null}
      <span className="block">
        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
      </span>
      <span className="block">{address.country}</span>
      <span className="mt-1 block">{address.phone}</span>
    </address>
  );
}

export function OrderSummaryMeta({
  order,
  className,
}: {
  order: OrderDetail;
  className?: string;
}) {
  const t = useT();

  return (
    <p className={cn('text-sm text-muted', className)}>
      {t.plural(order.itemCount, '{count} item', '{count} items')}
      {order.paymentMethodLabel ? ` · ${order.paymentMethodLabel}` : ''}
    </p>
  );
}
