import type { Metadata } from 'next';
import type { DiscountReference, DiscountRow, DiscountSummary, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { KIND_META, KIND_ORDER, STATE_META } from '@/lib/discounts';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { DiscountManager } from '@/components/admin/discount-manager';

export const metadata: Metadata = { title: 'Discounts' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  ...(['active', 'scheduled', 'paused', 'draft', 'expired', 'limit_reached'] as const).map((state) => ({
    value: state,
    label: STATE_META[state].label,
  })),
];

const KINDS = new Set<string>(KIND_ORDER);

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // A hand-edited `?kind=` asks for nothing rather than a 422 for the whole screen.
  const kind = single('kind');

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = {
    search: single('search'),
    status: single('status'),
    kind: kind && KINDS.has(kind) ? kind : undefined,
  };

  const [session, first, summary, reference] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGetListed<DiscountRow>('/api/v1/admin/discounts', { ...query, pageSize: BATCH_SIZE }),
    serverGet<DiscountSummary>('/api/v1/admin/discounts/summary'),
    serverGet<DiscountReference>('/api/v1/admin/discounts/reference'),
  ]);

  const canManage = session.authenticated && can(session.admin, 'marketing.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Coupon codes, automatic offers, vouchers, and bank and payment offers. Your store works out every discount at checkout."
      />

      <TableFilters searchPlaceholder="Name, code or note" statusOptions={STATUS_OPTIONS} />

      <DiscountManager
        initial={{ rows: first.data, meta: first.meta }}
        query={query}
        summary={summary}
        reference={reference}
        canManage={canManage}
        kindOptions={KIND_ORDER.map((value) => ({ value, label: KIND_META[value].short }))}
      />
    </div>
  );
}
