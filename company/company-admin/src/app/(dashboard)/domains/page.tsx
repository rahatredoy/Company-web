import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Globe } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { DomainActions } from '@/components/admin/domain-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { formatDate } from '@/lib/format';
import type { DomainRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Domains' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'failed', label: 'Failed' },
  { value: 'disabled', label: 'Disabled' },
];

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: domains, meta, unavailable } = await listOrEmpty<DomainRow>('/api/v1/admin/domains', params);

  return (
    <>
      <PageHeader
        title="Domains"
        description="Platform subdomains and the custom domains clients have connected."
      />

      {unavailable ? <ApiUnavailable resource="The domain list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters searchPlaceholder="Search domain or business name…" statusOptions={STATUS_FILTERS} />
      </Suspense>

      {domains.length === 0 ? (
        <EmptyState icon={Globe} title="No domains found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Primary</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell>
                        <Link href={`/clients/${domain.clientId}`} className="font-medium hover:text-primary">
                          {domain.businessName}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{domain.domain}</TableCell>
                      <TableCell>
                        <StatusBadge status={domain.domainType} />
                      </TableCell>
                      <TableCell>{domain.isPrimary ? <Badge variant="primary">Primary</Badge> : '—'}</TableCell>
                      <TableCell>
                        {domain.verified ? <Badge variant="success">Yes</Badge> : <Badge variant="warning">No</Badge>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={domain.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(domain.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DomainActions domain={domain} />
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
