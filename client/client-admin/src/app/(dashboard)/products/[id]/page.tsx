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
import { ReviewModeration } from '@/components/admin/review-moderation';
import { TableFilters } from '@/components/admin/table-filters';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  serverGet,
  serverGetOptional,
  serverGetListed,
} from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import type { MessageKey } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/types';
import type {
  AttributeRow,
  BrandRow,
  CategoryRow,
  ProductDetail,
  ProductInsights,
  ProductRow,
  ReviewRow,
  SessionResponse,
  StoreSettingsRow,
  WarehouseRow,
} from '@/lib/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Product') };
}

export const dynamic = 'force-dynamic';

/** The enum in the owner's words — `active` is published, `inactive` is archived. */
const STATUS_LABEL = { active: 'Published', draft: 'Draft', inactive: 'Archived' } as const satisfies Record<
  string,
  MessageKey
>;

const TABS = ['overview', 'details', 'variants', 'gallery', 'specifications', 'related', 'reviews'] as const;

const REVIEW_STATUS_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'All reviews' },
  { value: 'pending', label: 'Awaiting review' },
  { value: 'approved', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
];
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
  const [{ id }, query, t] = await Promise.all([params, searchParams, getT()]);

  const product = await serverGetOptional<ProductDetail>(`/api/v1/admin/products/${id}`);
  if (!product) notFound();

  const requested = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'overview';
  const stockParam = Array.isArray(query.stock) ? query.stock[0] : query.stock;
  const openStock = stockParam === 'add' || stockParam === 'adjust' ? stockParam : null;

  /*
   * The Reviews tab is where a product's reviews are moderated — there is no
   * store-wide queue screen. Its filters live in the URL beside `tab`, and the
   * list is read by product so the first batch and every later one agree.
   */
  const reviewStatusParam = Array.isArray(query.status) ? query.status[0] : query.status;
  const reviewSearch = Array.isArray(query.search) ? query.search[0] : query.search;
  const reviewQuery = { productId: id, status: reviewStatusParam, search: reviewSearch };
  const reviewsFiltered = Boolean(reviewSearch || (reviewStatusParam && reviewStatusParam !== 'all'));

  const [session, insights, warehouses, categories, brands, attributes, catalogue, settings, reviews] =
    await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
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
    /*
     * Every review of this product, first batch only. Optional: an admin
     * without `reviews.view` is refused, and that costs the tab, not the page.
     */
    serverGetListed<ReviewRow>('/api/v1/admin/reviews', { ...reviewQuery, pageSize: BATCH_SIZE }).catch(() => null),
  ]);

  const currency = session.authenticated ? session.store.currency : 'USD';
  // Permissions are enforced by the API on every one of these writes; this only
  // decides whether a control that would be refused is offered at all.
  const admin = session.authenticated ? session.admin : null;
  const canManage = can(admin, 'products.update');
  const canAdjust = can(admin, 'inventory.adjust');
  const canViewReviews = can(admin, 'reviews.view') && reviews !== null;
  const canManageReviews = can(admin, 'reviews.manage');

  return (
    <div className="space-y-5">
      <PageHeader
        title={product.name}
        breadcrumb={[{ label: t('Products'), href: '/products' }, { label: product.name }]}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">/{product.slug}</span>
            <span>{t('Added {date}', { date: t.date(product.createdAt) })}</span>
            {product.soldCount > 0 ? <span>{t('{count} sold', { count: product.soldCount })}</span> : null}
            <Badge variant={product.status === 'active' ? 'success' : product.status === 'draft' ? 'warning' : 'neutral'}>
              {t(STATUS_LABEL[product.status])}
            </Badge>
          </span>
        }
        actions={
          <ProductActions
            product={{ id: product.id, slug: product.slug, status: product.status }}
            variants={insights?.variants ?? []}
            warehouses={warehouses ?? []}
            canManage={canManage}
            canAdjust={canAdjust && (insights?.variants.length ?? 0) > 0}
            openWith={openStock}
          />
        }
      />

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="overview">{t('Overview')}</TabsTrigger>
          <TabsTrigger value="details">{t('Details')}</TabsTrigger>
          <TabsTrigger value="variants">{t('Variants ({count})', { count: product.variants.length })}</TabsTrigger>
          <TabsTrigger value="gallery">{t('Gallery ({count})', { count: product.media.length })}</TabsTrigger>
          <TabsTrigger value="specifications">
            {t('Specifications ({count})', { count: product.specifications.length })}
          </TabsTrigger>
          <TabsTrigger value="related">{t('Related')}</TabsTrigger>
          {canViewReviews ? (
            <TabsTrigger value="reviews">
              {t('Reviews')}
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          {insights ? (
            <ProductOverview insights={insights} />
          ) : (
            <Alert variant="warning">
              {t(
                'The figures for this product could not be read just now. Everything under the other tabs still works, and reloading usually clears it.',
              )}
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

        {canViewReviews && reviews ? (
          <TabsContent value="reviews" className="space-y-4">
            <TableFilters
              searchPlaceholder={t('Customer or wording')}
              statusOptions={REVIEW_STATUS_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
              preserveParams={['tab']}
            />
            <ReviewModeration
              initial={{ rows: reviews.data, meta: reviews.meta }}
              query={reviewQuery}
              canManage={canManageReviews}
              filtered={reviewsFiltered}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
