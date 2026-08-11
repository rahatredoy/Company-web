import type { Metadata } from 'next';
import { Package } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { EmptyState } from '@/components/admin/empty-state';
import { PlanFormDialog, PlanStatusToggle } from '@/components/admin/plan-form-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { serverGetOptional } from '@/lib/admin-api';
import { formatMoney, formatNumber, titleCase } from '@/lib/format';
import type { Plan } from '@/lib/types';

export const metadata: Metadata = { title: 'Plans' };

function limit(value: number | null) {
  return value === null ? 'Unlimited' : formatNumber(value);
}

function storage(value: number | null) {
  if (value === null) return 'Unlimited';
  return value >= 1024 ? `${Math.round(value / 1024)} GB` : `${value} MB`;
}

export default async function PlansPage() {
  const plans = (await serverGetOptional<Plan[]>('/api/v1/admin/plans')) ?? [];

  return (
    <>
      <PageHeader
        title="Plans"
        description="Pricing and limits. The website reads these values directly."
        actions={<PlanFormDialog />}
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No plans yet"
          description="Create your first plan so businesses can subscribe."
          action={<PlanFormDialog />}
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Monthly</TableHead>
                    <TableHead className="text-right">Yearly</TableHead>
                    <TableHead className="text-right">Products</TableHead>
                    <TableHead className="text-right">Admins</TableHead>
                    <TableHead className="text-right">Storage</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead>Support</TableHead>
                    <TableHead className="text-right">Subscribers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{plan.name}</span>
                          {plan.isFeatured ? <Badge variant="primary">Popular</Badge> : null}
                          {/* Disabling this one is how the free trial is switched off platform-wide. */}
                          {plan.isTrial ? <Badge variant="primary">Free trial</Badge> : null}
                        </div>
                        <code className="text-xs text-muted-foreground">{plan.code}</code>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatMoney(plan.monthlyPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatMoney(plan.yearlyPrice)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{limit(plan.productLimit)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{limit(plan.adminLimit)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{storage(plan.storageLimitMb)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {plan.customDomainEnabled ? <Badge variant="outline">Domain</Badge> : null}
                          {plan.customAdminDomainEnabled ? <Badge variant="outline">Admin domain</Badge> : null}
                          {plan.reportsEnabled ? <Badge variant="outline">Reports</Badge> : null}
                          {plan.analyticsEnabled ? <Badge variant="outline">Analytics</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{titleCase(plan.supportLevel)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(plan.subscriberCount ?? 0)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PlanStatusToggle plan={plan} />
                          <StatusBadge status={plan.status} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <PlanFormDialog plan={plan} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}
    </>
  );
}
