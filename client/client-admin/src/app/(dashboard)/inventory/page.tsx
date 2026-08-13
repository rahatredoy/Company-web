import type { Metadata } from 'next';
import { Warehouse } from 'lucide-react';
import type { InventoryRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatRelative } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { StockAdjuster } from '@/components/admin/stock-adjuster';
import { Badge } from '@/components/ui/badge';
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

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'low', label: 'Running low' },
  { value: 'in_stock', label: 'In stock' },
];

export default async function InventoryPage({
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
  const canAdjust = session.authenticated && can(session.admin, 'inventory.adjust');

  const { data, meta } = await serverGetPaginated<InventoryRow>('/api/v1/admin/inventory', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Emptiest first — the rows that need doing something about are at the top."
      />

      <TableFilters searchPlaceholder="Product name or SKU" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={Warehouse}
          title="Nothing is being tracked yet"
          description="A product with no stock record is treated as always available. Adjust one to start counting it."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={6}>No stock matches those filters.</TableEmpty>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="block font-medium">{row.productName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[row.variantTitle, row.sku].filter(Boolean).join(' · ')}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.warehouseName}</TableCell>
                      <TableCell className="text-right">
                        <span className="font-medium tabular-nums">{row.available}</span>
                        {row.available <= 0 ? (
                          <Badge variant="danger" className="ml-2">
                            Out
                          </Badge>
                        ) : row.available <= row.lowStockThreshold ? (
                          <Badge variant="warning" className="ml-2">
                            Low
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.reserved}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(row.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <StockAdjuster row={row} canAdjust={canAdjust} />
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
