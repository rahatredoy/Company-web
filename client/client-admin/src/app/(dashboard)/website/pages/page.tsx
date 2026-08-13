import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import type { PageRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatRelative } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Pages' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All pages' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
];

export default async function PagesListPage({
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
  const canManage = session.authenticated && can(session.admin, 'website.manage');

  const { data, meta } = await serverGetPaginated<PageRow>('/api/v1/admin/website/pages', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages"
        description="Your About, Contact and policy pages — the copy your storefront links to."
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href="/website/pages/new">
                <Plus aria-hidden /> New page
              </Link>
            </Button>
          ) : null
        }
      />

      <TableFilters searchPlaceholder="Page title" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState icon={FileText} title="No pages yet" description="Add one to link it from your footer." />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In footer</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={5}>No page matches those filters.</TableEmpty>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link href={`/website/pages/${row.id}`} className="font-medium hover:underline">
                          {row.title}
                        </Link>
                        {row.systemKey ? (
                          <Badge variant="info" className="ml-2">
                            Policy
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">/page/{row.slug}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.showInFooter ? 'Yes' : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(row.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
          <Pagination {...meta} />
        </>
      )}
    </div>
  );
}
