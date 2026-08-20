import type { Metadata } from 'next';
import type { CouponRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { CouponManager } from '@/components/admin/coupon-manager';

export const metadata: Metadata = { title: 'Discounts' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All codes' },
  { value: 'active', label: 'Live' },
  { value: 'disabled', label: 'Switched off' },
  { value: 'expired', label: 'Expired' },
];

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

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const currency = session.authenticated ? session.store.currency : 'USD';
  const canManage = session.authenticated && can(session.admin, 'marketing.manage');

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = { search: single('search'), status: single('status') };
  const first = await serverGetListed<CouponRow>('/api/v1/admin/coupons', {
    ...query,
    pageSize: BATCH_SIZE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Codes customers type at checkout. Your store decides what each one is worth."
      />

      <TableFilters searchPlaceholder="Code or description" statusOptions={STATUS_OPTIONS} />

      <CouponManager
        initial={{ rows: first.data, meta: first.meta }}
        query={query}
        currency={currency}
        canManage={canManage}
      />
    </div>
  );
}
