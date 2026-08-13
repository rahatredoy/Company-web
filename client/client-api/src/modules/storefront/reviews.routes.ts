import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderItems, orders, products, reviewImages, reviews } from '../../db/schema/index';
import { ERROR_CODES, notFound, unauthorized } from '../../lib/errors';
import { buildMeta, ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { storeOf } from '../../plugins/tenant';
import { PUBLISHED_PRODUCT } from './service';
import type { ReviewSummaryView, ReviewView } from './types';

const paramsSchema = z.object({ slug: z.string().trim().min(1).max(220) });

const submitSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  body: z.string().trim().min(10, 'Tell us a little more.').max(2000),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  sort: z.enum(['recent', 'rating_desc', 'rating_asc']).default('recent'),
});

/**
 * Approved reviews for one product, with the rating histogram.
 *
 * `status = 'approved'` is the whole of the moderation boundary on this surface:
 * a pending review is visible to the owner in the panel and to nobody else, and
 * a rejected one never becomes visible again. Moderation columns — who approved
 * it, when, and any internal note — are not selected at all rather than selected
 * and dropped, so they cannot be leaked by a later careless spread.
 */
export default async function storefrontReviewRoutes(app: FastifyInstance) {
  app.get('/products/:slug/reviews', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(paramsSchema, request.params);
    const query = parseQuery(querySchema, request.query);

    const [product] = await store.db
      .select({ id: products.id })
      .from(products)
      .where(and(PUBLISHED_PRODUCT, eq(products.slug, slug)))
      .limit(1);

    if (!product) throw notFound('This product does not exist.');

    const approved = and(eq(reviews.productId, product.id), eq(reviews.status, 'approved'));

    const orderBy =
      query.sort === 'rating_desc'
        ? [desc(reviews.rating), desc(reviews.createdAt)]
        : query.sort === 'rating_asc'
          ? [asc(reviews.rating), desc(reviews.createdAt)]
          : [desc(reviews.createdAt)];

    const [rows, tally, histogram] = await Promise.all([
      store.db
        .select({
          id: reviews.id,
          customerName: reviews.customerName,
          rating: reviews.rating,
          body: reviews.body,
          verifiedPurchase: reviews.verifiedPurchase,
          createdAt: reviews.createdAt,
          adminReply: reviews.adminReply,
          adminRepliedAt: reviews.adminRepliedAt,
        })
        .from(reviews)
        .where(approved)
        .orderBy(...orderBy)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),

      store.db.select({ total: count() }).from(reviews).where(approved),

      store.db
        .select({ rating: reviews.rating, total: count() })
        .from(reviews)
        .where(approved)
        .groupBy(reviews.rating),
    ]);

    const imagesBy = new Map<string, string[]>();
    if (rows.length > 0) {
      const imageRows = await store.db
        .select({ reviewId: reviewImages.reviewId, url: reviewImages.url })
        .from(reviewImages)
        .where(inArray(reviewImages.reviewId, rows.map((row) => row.id)));

      for (const image of imageRows) {
        imagesBy.set(image.reviewId, [...(imagesBy.get(image.reviewId) ?? []), image.url]);
      }
    }

    // Index 0 is one star, so the histogram bars line up with the labels without
    // the component having to know which end the array starts at.
    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let weighted = 0;
    let counted = 0;
    for (const bucket of histogram) {
      const index = bucket.rating - 1;
      if (index < 0 || index > 4) continue;
      const total = Number(bucket.total);
      distribution[index] = total;
      weighted += bucket.rating * total;
      counted += total;
    }

    const items: ReviewView[] = rows.map((row) => ({
      id: row.id,
      customerName: row.customerName,
      rating: row.rating,
      body: row.body,
      verifiedPurchase: row.verifiedPurchase,
      createdAt: row.createdAt.toISOString(),
      images: imagesBy.get(row.id) ?? [],
      adminReply: row.adminReply,
      adminRepliedAt: row.adminRepliedAt?.toISOString() ?? null,
    }));

    const summary: ReviewSummaryView = {
      // Derived from the approved rows rather than read off `products.rating_average`,
      // which counts every review the moderation queue has ever seen.
      average: counted > 0 ? Math.round((weighted / counted) * 10) / 10 : 0,
      count: counted,
      distribution,
    };

    return ok(reply, {
      items,
      summary,
      meta: buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
    });
  });

  /**
   * Leaving a review.
   *
   * Always lands as `pending`. Owner-authored copy is the storefront's softest
   * surface and shopper-authored copy is softer still, so nothing a stranger
   * writes appears on a shop until someone has looked at it — which is exactly
   * the gate the read endpoint above enforces with `status = 'approved'`.
   *
   * `verified_purchase` is decided here from the order history, never accepted
   * from the request: it is the one claim on a review that carries weight.
   */
  app.post(
    '/products/:slug/reviews',
    { preHandler: [app.optionalCustomer] },
    async (request, reply) => {
      const store = storeOf(request);
      const { slug } = parseParams(paramsSchema, request.params);
      const body = parseBody(submitSchema, request.body);
      await enforce(request, 'review-submit', { max: 5, windowSeconds: 300 });

      const [product] = await store.db
        .select({ id: products.id })
        .from(products)
        .where(and(PUBLISHED_PRODUCT, eq(products.slug, slug)))
        .limit(1);

      if (!product) throw notFound('This product does not exist.');

      const customer = request.customer;
      if (!customer) {
        throw unauthorized('Sign in to leave a review.', ERROR_CODES.UNAUTHORIZED);
      }

      const [purchased] = await store.db
        .select({ orderId: orders.id })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orderItems.productId, product.id),
            eq(orders.customerId, customer.customerId),
            inArray(orders.status, ['delivered', 'returned', 'refunded']),
          ),
        )
        .limit(1);

      /*
       * One review per customer per product, enforced by a unique index. Editing
       * replaces rather than adding, and an edit goes back through moderation —
       * otherwise an approved review could be rewritten into anything.
       */
      await store.db
        .insert(reviews)
        .values({
          productId: product.id,
          customerId: customer.customerId,
          orderId: purchased?.orderId ?? null,
          customerName: customer.fullName,
          rating: body.rating,
          body: body.body,
          status: 'pending',
          verifiedPurchase: Boolean(purchased),
        })
        .onConflictDoUpdate({
          target: [reviews.productId, reviews.customerId],
          set: {
            rating: body.rating,
            body: body.body,
            status: 'pending',
            verifiedPurchase: Boolean(purchased),
            updatedAt: new Date(),
          },
        });

      return ok(reply, { status: 'pending' as const }, 202);
    },
  );
}
