import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { ProductActions } from '@/components/admin/product-actions';
import { ProductAttributes } from '@/components/admin/product-attributes';
import { ProductBundle } from '@/components/admin/product-bundle';
import { ProductForm } from '@/components/admin/product-form';
import { ProductGallery } from '@/components/admin/product-gallery';
import { ProductOverview } from '@/components/admin/product-overview';
import { ProductSpecifications } from '@/components/admin/product-specifications';
import { ProductVariants } from '@/components/admin/product-variants';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  currentStoreSlug,
  serverGet,
  serverGetOptional,
  serverGetListed,
} from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { formatDate, formatNumber } from '@/lib/format';
import { can } from '@/lib/types';
import type {
  AttributeRow,
  BrandRow,
  CategoryRow,
  ProductDetail,
  ProductInsights,
  ProductRow,
  SessionResponse,
  StoreSettingsRow,
  WarehouseRow,
} from '@/lib/types';

export const metadata: Metadata = { title: 'Product' };
export const dynamic = 'force-dynamic';

/** The enum in the owner's words — `active` is published, `inactive` is archived. */
const STATUS_LABEL = { active: 'Published', draft: 'Draft', inactive: 'Archived' } as const;

const TABS = ['overview', 'details', 'variants', 'gallery', 'specifications', 'related'] as const;
type Tab = (typeof TABS)[number];

/**
 * One product: what it has done, then what it is.
 *
 * **Overview opens the screen** because that is the question an owner arrives
 * with — how much stock came in, how much is left, how much sold, how much came
 * back, and what the whole thing made. The five tabs behind it are the editor,
 * and they stay tabs rather than becoming pages so that none of them can be
 * forgotten: a product with no gallery and no specifications looks unfinished
 * here, and would look finished if those lived somewhere else.
 *
 * The editing tabs are separate saves rather than one giant form, because each
 * of the lists behind them is written to the API as a whole list — one Save
 * posting all five would turn a failed variant validation into a lost gallery
 * edit.
 *
 * Which tab is open lives in the URL rather than in component state, so
 * "Edit product" can link straight at the form and a reader can send somebody
 * the tab they are actually looking at.
 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const product = await serverGetOptional<ProductDetail>(`/api/v1/admin/products/${id}`);
  if (!product) notFound();

  const requested = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'overview';

  const [session, slug, insights, warehouses, categories, brands, attributes, catalogue, settings] =
    await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    currentStoreSlug(),
    /*
     * Optional on purpose. The figures are eight aggregates over six tables and
     * the editor beneath them needs none of it — a screen that refused to open
     * because one `sum()` timed out would take the owner's ability to fix the
     * product away along with the numbers describing it.
     */
    serverGetOptional<ProductInsights>(`/api/v1/admin/products/${id}/insights`, { days: 30 }),
    serverGetOptional<WarehouseRow[]>('/api/v1/admin/warehouses'),
    serverGetListed<CategoryRow>('/api/v1/admin/categories', { pageSize: 100, status: 'active' }),
    serverGetListed<BrandRow>('/api/v1/admin/brands', { pageSize: 100, status: 'active' }),
    serverGet<AttributeRow[]>('/api/v1/admin/attributes'),
    serverGetListed<ProductRow>('/api/v1/admin/products', { pageSize: 100, sort: 'name' }),
    /*
     * Only for the measure picker's fallback list, and optional for that reason:
     * a settings read that fails must not take the product editor with it. The
     * form falls back to the platform default when this is absent, which is what
     * the API would have applied anyway.
     */
    serverGetOptional<StoreSettingsRow>('/api/v1/admin/settings'),
  ]);

  const currency = session.authenticated ? session.store.currency : 'USD';
  // Permissions are enforced by the API on every one of these writes; this only
  // decides whether a control that would be refused is offered at all.
  const admin = session.authenticated ? session.admin : null;
  const canManage = can(admin, 'products.update');
  const canAdjust = can(admin, 'inventory.adjust');
  const storeUrl = slug ? storefrontUrl(slug) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={product.name}
        breadcrumb={[{ label: 'Products', href: '/products' }, { label: product.name }]}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">/{product.slug}</span>
            <span>Added {formatDate(product.createdAt)}</span>
            {product.soldCount > 0 ? <span>{formatNumber(product.soldCount)} sold</span> : null}
            <Badge variant={product.status === 'active' ? 'success' : product.status === 'draft' ? 'warning' : 'neutral'}>
              {STATUS_LABEL[product.status]}
            </Badge>
          </span>
        }
        actions={
          <ProductActions
            product={{ id: product.id, slug: product.slug, status: product.status }}
            variants={insights?.variants ?? []}
            warehouses={warehouses ?? []}
            storefrontUrl={storeUrl}
            canManage={canManage}
            canAdjust={canAdjust && (insights?.variants.length ?? 0) > 0}
          />
        }
      />

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="variants">Variants ({product.variants.length})</TabsTrigger>
          <TabsTrigger value="gallery">Gallery ({product.media.length})</TabsTrigger>
          <TabsTrigger value="specifications">Specifications ({product.specifications.length})</TabsTrigger>
          <TabsTrigger value="related">Related</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {insights ? (
            <ProductOverview insights={insights} storefrontUrl={storeUrl} />
          ) : (
            <Alert variant="warning">
              The figures for this product could not be read just now. Everything under the other tabs still
              works, and reloading usually clears it.
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="details">
          <ProductForm
            product={product}
            categories={categories.data}
            brands={brands.data}
            currency={currency}
            storeMeasureOptions={settings?.measureOptions}
          />
        </TabsContent>

        <TabsContent value="variants">
          <ProductVariants
            productId={product.id}
            variants={product.variants}
            attributes={attributes}
            currency={currency}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="gallery">
          <ProductGallery productId={product.id} media={product.media} canManage={canManage} />
        </TabsContent>

        <TabsContent value="specifications">
          <ProductSpecifications
            productId={product.id}
            specifications={product.specifications}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="related" className="space-y-6">
          <ProductAttributes
            productId={product.id}
            attributes={attributes}
            selected={product.attributeValueIds}
            canManage={canManage}
          />
          <ProductBundle
            productId={product.id}
            candidates={catalogue.data.map((row) => ({ id: row.id, name: row.name }))}
            selected={product.bundleProductIds}
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
