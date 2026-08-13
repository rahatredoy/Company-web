import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { ProductForm } from '@/components/admin/product-form';
import { Badge } from '@/components/ui/badge';
import { serverGet, serverGetOptional, serverGetPaginated } from '@/lib/server-api';
import { formatDate, formatNumber } from '@/lib/format';
import type { BrandRow, CategoryRow, ProductDetail, SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Product' };
export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await serverGetOptional<ProductDetail>(`/api/v1/admin/products/${id}`);
  if (!product) notFound();

  const [session, categories, brands] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGetPaginated<CategoryRow>('/api/v1/admin/categories', { pageSize: 100, status: 'active' }),
    serverGetPaginated<BrandRow>('/api/v1/admin/brands', { pageSize: 100, status: 'active' }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">/{product.slug}</span>
            <span>Added {formatDate(product.createdAt)}</span>
            {product.soldCount > 0 ? <span>{formatNumber(product.soldCount)} sold</span> : null}
          </span>
        }
        actions={<Badge variant={product.status === 'active' ? 'success' : 'neutral'}>{product.status}</Badge>}
      />

      <ProductForm
        product={product}
        categories={categories.data}
        brands={brands.data}
        currency={session.authenticated ? session.store.currency : 'USD'}
      />
    </div>
  );
}
