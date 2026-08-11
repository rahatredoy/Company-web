import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AlertTriangle, CheckCircle2, Timer, TimerOff } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { TrialActions } from '@/components/admin/trial-actions';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { listOrEmpty, serverGetOptional } from '@/lib/admin-api';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TrialRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Trials' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring Soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'converted', label: 'Converted' },
];

interface TrialSummary {
  active: number;
  expiringSoon: number;
  expired: number;
  converted: number;
}

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const [{ data: trials, meta, unavailable }, summary] = await Promise.all([
    listOrEmpty<TrialRow>('/api/v1/admin/trials', params),
    serverGetOptional<TrialSummary>('/api/v1/admin/trials/summary'),
  ]);

  const cards = [
    { label: 'Active Trials', value: summary?.active ?? 0, icon: Timer, tint: 'bg-primary-soft text-accent-foreground' },
    {
      label: 'Expiring Soon',
      value: summary?.expiringSoon ?? 0,
      icon: AlertTriangle,
      tint: 'bg-warning-soft text-warning',
    },
    { label: 'Expired', value: summary?.expired ?? 0, icon: TimerOff, tint: 'bg-destructive-soft text-destructive' },
    { label: 'Converted', value: summary?.converted ?? 0, icon: CheckCircle2, tint: 'bg-success-soft text-success' },
  ];

  return (
    <>
      <PageHeader title="Trials" description="Free trials in progress and how they ended." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', card.tint)}>
                <card.icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold tabular-nums">{formatNumber(card.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {unavailable ? <ApiUnavailable resource="The trial list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters searchPlaceholder="Search by business name…" statusOptions={STATUS_FILTERS} />
      </Suspense>

      {trials.length === 0 ? (
        <EmptyState icon={Timer} title="No trials found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Tenant ID</TableHead>
                    <TableHead>Start date</TableHead>
                    <TableHead>End date</TableHead>
                    <TableHead>Days remaining</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trials.map((trial) => (
                    <TableRow key={trial.id}>
                      <TableCell>
                        <Link href={`/clients/${trial.clientId}`} className="font-medium hover:text-primary">
                          {trial.businessName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs text-muted-foreground">{trial.tenantId}</code>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(trial.startedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(trial.endsAt)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'font-medium tabular-nums',
                            trial.status === 'active' && trial.daysRemaining <= 5 ? 'text-destructive' : '',
                          )}
                        >
                          {trial.status === 'active' ? `${trial.daysRemaining} days` : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={trial.status} />
                      </TableCell>
                      <TableCell>
                        <TrialActions trial={trial} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}

      <Suspense fallback={null}>
        <Pagination {...meta} />
      </Suspense>
    </>
  );
}
