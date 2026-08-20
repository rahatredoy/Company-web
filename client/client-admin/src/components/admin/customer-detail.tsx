'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import type { CustomerRow, CustomerView } from '@/lib/types';
import {
  DetailBool,
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
  DetailTable,
} from './detail-sheet';

/**
 * Whether a browser is still signed in.
 *
 * Its own component so the clock is read in a `useState` initializer — once on
 * mount rather than on every render, which is what keeps the cell idempotent.
 * A session expiring is a matter of days, so reading it when the panel opens is
 * the right granularity.
 */
function SessionState({ revokedAt, expiresAt }: { revokedAt: string | null; expiresAt: string }) {
  const [now] = React.useState(() => Date.now());

  if (revokedAt) return <StatusBadge status="cancelled" label="Signed out" />;
  if (new Date(expiresAt).getTime() < now) return <StatusBadge status="expired" />;
  return <StatusBadge status="active" />;
}

/**
 * A shopper's account, whole.
 *
 * This is the panel with no storefront counterpart at all — a customer has no
 * public page, which is why "view" on this list used to do nothing but open a
 * route. What a shop actually needs to answer about a person is spread across
 * five tables: the account, its addresses, its orders, the browsers it is signed
 * in on, and the lockout state that explains why a sign-in is failing.
 *
 * The lockout block is the reason `failed_login_count` and `locked_until` are
 * returned at all. "I can't log in" is the single most common thing a shop is
 * emailed about, and without these the owner's only honest answer is a shrug.
 * The password hash is a different matter and never leaves the API — what is
 * shown is *whether* one exists, which is what separates an account that can
 * sign in from one that never could.
 */
export function CustomerDetail({
  row,
  open,
  onOpenChange,
  currency,
}: {
  /** The list row, which supplies the header while the record is in flight. */
  row: CustomerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const detail = useDetail<CustomerView>({
    path: '/api/v1/admin/customers',
    id: row?.id ?? null,
    enabled: open,
  });

  const customer = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={customer?.fullName ?? row?.fullName ?? 'Customer'}
      subtitle={customer?.email ?? row?.email}
      badge={
        <>
          <StatusBadge status={customer?.status ?? row?.status ?? 'active'} />
          {customer?.isLocked ? <StatusBadge status="failed" label="Locked out" /> : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/customers/${row.id}`}>Open full record</Link>
          </Button>
        ) : null
      }
    >
      {customer ? (
        <div className="space-y-6">
          <DetailSection title="Account">
            <DetailGrid>
              <DetailField label="Full name" value={customer.fullName} />
              <DetailField label="Email" value={customer.email} />
              <DetailField label="Phone" value={customer.phone} />
              <DetailField label="Status" value={<StatusBadge status={customer.status} />} />
              <DetailField
                label="Segment"
                value={titleCase(customer.customerType)}
                hint="Derived from order history, never set by hand."
              />
              <DetailField
                label="Email verified"
                value={
                  customer.emailVerified ? (
                    formatDateTime(customer.emailVerifiedAt)
                  ) : (
                    <span className="text-warning">Not verified</span>
                  )
                }
              />
              <DetailField label="Accepts marketing" value={<DetailBool value={customer.acceptsMarketing} />} />
              <DetailField label="Registered" value={formatDateTime(customer.createdAt)} />
              <DetailField label="Record updated" value={formatDateTime(customer.updatedAt)} />
              <DetailField label="Customer ID" value={<DetailId value={customer.id} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Sign-in"
            description="Why an account can or cannot get in. The password itself is never readable here."
          >
            <DetailGrid>
              <DetailField label="Has a password" value={<DetailBool value={customer.hasPassword} />} />
              <DetailField label="Last signed in" value={formatDateTime(customer.lastLoginAt)} />
              <DetailField label="Last sign-in address" value={customer.lastLoginIp} mono />
              <DetailField label="Password last changed" value={formatDateTime(customer.passwordChangedAt)} />
              <DetailField
                label="Failed attempts"
                value={formatNumber(customer.failedLoginCount)}
                hint="Resets on a successful sign-in."
              />
              <DetailField
                label="Locked until"
                value={
                  customer.lockedUntil ? (
                    <span className={customer.isLocked ? 'text-destructive' : undefined}>
                      {formatDateTime(customer.lockedUntil)}
                    </span>
                  ) : null
                }
                hint={customer.isLocked ? 'Sign-in is being refused right now.' : undefined}
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Lifetime">
            <DetailGrid>
              <DetailField label="Orders placed" value={formatNumber(customer.stats.orderCount)} />
              <DetailField
                label="Spent"
                value={formatMoney(customer.stats.totalSpent, currency)}
                hint="Cancelled and failed orders excluded."
              />
              <DetailField label="Refunded" value={formatMoney(customer.stats.refundedTotal, currency)} />
              <DetailField label="Reviews written" value={formatNumber(customer.stats.reviewCount)} />
              <DetailField label="Wishlisted items" value={formatNumber(customer.stats.wishlistCount)} />
              <DetailField label="First order" value={formatDate(customer.stats.firstOrderAt)} />
              <DetailField label="Latest order" value={formatDate(customer.stats.lastOrderAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Orders"
            action={
              customer.orders.length >= 50 ? (
                <span className="text-xs text-muted-foreground">Most recent 50</span>
              ) : null
            }
          >
            <DetailTable
              rows={customer.orders}
              rowKey={(order) => order.id}
              empty="This account has never ordered."
              columns={[
                {
                  key: 'order',
                  header: 'Order',
                  cell: (order) => (
                    <Link href={`/orders/${order.id}`} className="font-mono text-[13px] hover:underline">
                      {order.orderNumber}
                    </Link>
                  ),
                },
                { key: 'placed', header: 'Placed', cell: (order) => formatDate(order.placedAt) },
                { key: 'status', header: 'Status', cell: (order) => <StatusBadge status={order.status} /> },
                {
                  key: 'payment',
                  header: 'Payment',
                  cell: (order) => <StatusBadge status={order.paymentStatus} />,
                },
                { key: 'items', header: 'Items', align: 'right', cell: (order) => order.itemCount },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  cell: (order) => formatMoney(order.grandTotal, order.currency),
                },
              ]}
            />
          </DetailSection>

          <DetailSection title="Addresses">
            {customer.addresses.length === 0 ? (
              <DetailEmpty>No address saved.</DetailEmpty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {customer.addresses.map((address) => (
                  <div key={address.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{address.label ?? titleCase(address.type)}</span>
                      <StatusBadge status={address.type} />
                      {address.isDefault ? <StatusBadge status="active" label="Default" /> : null}
                    </div>
                    <p>{address.fullName}</p>
                    <p className="text-muted-foreground">{address.phone}</p>
                    <p className="text-muted-foreground">
                      {address.addressLine1}
                      {address.addressLine2 ? `, ${address.addressLine2}` : ''}
                      <br />
                      {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
                      <br />
                      {address.country}
                    </p>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Added {formatDate(address.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection
            title="Signed-in browsers"
            description="The ten most recent. The session token is stored only as a hash and is never shown."
          >
            <DetailTable
              rows={customer.sessions}
              rowKey={(session) => session.id}
              empty="No session on record."
              columns={[
                {
                  key: 'device',
                  header: 'Device',
                  cell: (session) => (
                    <span className="line-clamp-2 max-w-[22rem] text-xs">{session.userAgent ?? '—'}</span>
                  ),
                },
                {
                  key: 'ip',
                  header: 'Address',
                  cell: (session) => <span className="font-mono text-xs">{session.ipAddress ?? '—'}</span>,
                },
                { key: 'seen', header: 'Last seen', cell: (session) => formatDateTime(session.lastSeenAt) },
                {
                  key: 'state',
                  header: 'State',
                  cell: (session) => (
                    <SessionState revokedAt={session.revokedAt} expiresAt={session.expiresAt} />
                  ),
                },
              ]}
            />
          </DetailSection>

          <DetailSection title="Staff note" description="Never shown to the customer.">
            {customer.adminNote ? (
              <DetailProse>{customer.adminNote}</DetailProse>
            ) : (
              <DetailEmpty>No note.</DetailEmpty>
            )}
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}
