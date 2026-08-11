import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import type { AuditLogRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Audit Logs' };

const ACTION_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'admin_login', label: 'Sign-ins' },
  { value: 'client', label: 'Client changes' },
  { value: 'subscription', label: 'Subscriptions' },
  { value: 'trial', label: 'Trials' },
  { value: 'domain', label: 'Domains' },
  { value: 'settings', label: 'Settings' },
];

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: logs, meta, unavailable } = await listOrEmpty<AuditLogRow>('/api/v1/admin/audit', params);

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Every sensitive company-admin action, with actor, IP and before/after values."
      />

      {unavailable ? <ApiUnavailable resource="The audit log" /> : null}

      <Alert variant="info">
        Audit logs are read-only. They cannot be edited or deleted from this panel.
      </Alert>

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters
          searchPlaceholder="Search action, tenant or business name…"
          statusOptions={ACTION_FILTERS}
        />
      </Suspense>

      {logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Client / Tenant</TableHead>
                    <TableHead>Old value</TableHead>
                    <TableHead>New value</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Request</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{titleCase(log.action)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{log.actor}</TableCell>
                      <TableCell>
                        {log.businessName ? (
                          <span className="block max-w-40 truncate">{log.businessName}</span>
                        ) : (
                          '—'
                        )}
                        {log.tenantId ? (
                          <code className="text-xs text-muted-foreground">{log.tenantId}</code>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-40">
                        <span className="block truncate text-xs text-muted-foreground" title={log.oldValue ?? ''}>
                          {log.oldValue ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-40">
                        <span className="block truncate text-xs" title={log.newValue ?? ''}>
                          {log.newValue ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {log.ipAddress ?? '—'}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs text-muted-foreground">
                          {log.requestId ? log.requestId.slice(0, 8) : '—'}
                        </code>
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

      <p className="text-xs text-muted-foreground">
        Looking for a specific client&apos;s history? Open the client and use the{' '}
        <Link href="/clients" className="text-primary hover:underline">
          Activity
        </Link>{' '}
        tab.
      </p>
    </>
  );
}
