import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Server } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { ProvisioningRetry } from '@/components/admin/provisioning-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
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
import { listOrEmpty } from '@/lib/admin-api';
import { formatDateTime, titleCase } from '@/lib/format';
import type { ProvisioningJob } from '@/lib/types';

export const metadata: Metadata = { title: 'Provisioning' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'creating', label: 'Creating' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export default async function ProvisioningPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: jobs, meta, unavailable } = await listOrEmpty<ProvisioningJob>(
    '/api/v1/admin/provisioning',
    params,
  );

  const failed = jobs.filter((job) => job.status === 'failed').length;

  return (
    <>
      <PageHeader
        title="Provisioning"
        description="Tenant creation jobs — tenant record, database, schema, store config, admin and subdomain."
      />

      {unavailable ? <ApiUnavailable resource="The provisioning list" /> : null}

      {failed > 0 ? (
        <Alert variant="warning" title={`${failed} provisioning ${failed === 1 ? 'job has' : 'jobs have'} failed`}>
          Retry a failed job once the underlying cause is resolved. Client trials do not start until
          provisioning succeeds, so no trial days are lost.
        </Alert>
      ) : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters searchPlaceholder="Search tenant ID or business name…" statusOptions={STATUS_FILTERS} />
      </Suspense>

      {jobs.length === 0 ? (
        <EmptyState icon={Server} title="No provisioning jobs found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Tenant ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current step</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link href={`/clients/${job.clientId}`} className="font-medium hover:text-primary">
                          {job.businessName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs text-muted-foreground">{job.tenantId}</code>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {job.currentStep ? titleCase(job.currentStep) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(job.startedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(job.completedAt)}
                      </TableCell>
                      <TableCell className="max-w-56">
                        {job.errorMessage ? (
                          <span className="block truncate text-xs text-destructive" title={job.errorMessage}>
                            {job.errorMessage}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <ProvisioningRetry job={job} />
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
