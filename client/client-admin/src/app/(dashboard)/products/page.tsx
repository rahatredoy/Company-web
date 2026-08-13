import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, Plus } from 'lucide-react';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatMoney, formatNumber } from '@/lib/format';
import type { ProductRow, ProductStatus, SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'inactive', label: 'Inactive' },
];

const STATUS_TONE: Record<ProductStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  draft: 'warning',
  inactive: 'neutral',
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // The store's own currency, so prices are not silently shown in dollars to a
  // shop that trades in something else.
  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const currency = session.authenticated ? session.store.currency : 'USD';

  const { data, meta } = await serverGetPaginated<ProductRow>('/api/v1/admin/products', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
    sort: single('sort'),
    order: single('order'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Everything your store sells."
        actions={
          <Button asChild>
            <Link href="/products/new">
              <Plus /> New product
            </Link>
          </Button>
        }
      />

      <TableFilters searchPlaceholder="Search by name or web address…" statusOptions={STATUS_FILTERS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Add the first one and it will show up here, ready to publish when you are."
          action={
            <Button asChild>
              <Link href="/products/new">
                <Plus /> Add your first product
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={7}>No product matches those filters.</TableEmpty>
                ) : (
                  data.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Link href={`/products/${product.id}`} className="font-medium hover:underline">
                          {product.name}
                        </Link>
                        {product.isFeatured ? (
                          <Badge variant="outline" className="ml-2">
                            Featured
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {product.sku ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.categoryName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{product.brandName ?? '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {product.salePriceFrom ? (
                          <span className="space-x-1.5">
                            <span className="font-medium">{formatMoney(product.salePriceFrom, currency)}</span>
                            <span className="text-xs text-muted-foreground line-through">
                              {formatMoney(product.priceFrom, currency)}
                            </span>
                          </span>
                        ) : (
                          <span className="font-medium">{formatMoney(product.priceFrom, currency)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatNumber(product.soldCount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONE[product.status]}>{product.status}</Badge>
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
