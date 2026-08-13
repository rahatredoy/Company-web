import type { Metadata } from 'next';
import type { CouponRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
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

  const { data, meta } = await serverGetPaginated<CouponRow>('/api/v1/admin/coupons', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Codes customers type at checkout. Your store decides what each one is worth."
      />

      <TableFilters searchPlaceholder="Code or description" statusOptions={STATUS_OPTIONS} />

      <CouponManager rows={data} currency={currency} canManage={canManage} />
      <Pagination {...meta} />
    </div>
  );
}
