import { and, asc, avg, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customers, orders, products, reviewImages, reviews } from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { storeOf } from '../../plugins/tenant';

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  /** One product's reviews — the product screen's Reviews tab reads the list this way. */
  productId: z.string().uuid().optional(),
  status: z.enum(['all', 'pending', 'approved', 'rejected']).default('all'),
  sort: z.enum(['createdAt', 'rating']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const moderateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
});

const replySchema = z.object({
  adminReply: z.string().trim().max(2000).nullable().default(null),
});

/**
 * Review moderation.
 *
 * The queue that the storefront's `status = 'approved'` filter is the other half
 * of. Approving or rejecting changes what the public sees, so every write here
 * drops the storefront cache — otherwise a rejected review would stay on the
 * product page for the length of the TTL.
 *
 * The product's `rating_average` and `rating_count` are recomputed from the
 * approved rows on every change, in the same transaction. Keeping a running
 * total instead means one missed decrement leaves a shop advertising a rating it
 * cannot justify, and nothing ever notices.
 */
export default async function adminReviewRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  app.get(
    '/reviews',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('reviews.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(
              ilike(reviews.customerName, `%${query.search}%`),
              ilike(reviews.body, `%${query.search}%`),
              ilike(products.name, `%${query.search}%`),
            )
          : undefined,
        query.status === 'all' ? undefined : eq(reviews.status, query.status),
        query.productId ? eq(reviews.productId, query.productId) : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      /*
       * The chosen column, then the id — the id is what makes the order total.
       * Sorting by rating alone puts thousands of rows in an arbitrary order
       * within each star, and a cursor into a list with ties names no position.
       */
      const page = keyset<{ id: string; createdAt: Date; rating: number }>([
        { expr: reviews[query.sort], order: query.order, of: (row) => row[query.sort] },
        { expr: reviews.id, order: query.order, of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: reviews.id,
            productId: reviews.productId,
            productName: products.name,
            productSlug: products.slug,
            customerName: reviews.customerName,
            rating: reviews.rating,
            body: reviews.body,
            status: reviews.status,
            verifiedPurchase: reviews.verifiedPurchase,
            adminReply: reviews.adminReply,
            createdAt: reviews.createdAt,
          })
          .from(reviews)
          .innerJoin(products, eq(products.id, reviews.productId))
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor
          ? undefined
          : store.db
              .select({ total: count() })
              .from(reviews)
              .innerJoin(products, eq(products.id, reviews.productId))
              .where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      // A pending count for the queue badge comes from this same endpoint with
      // `?status=pending&pageSize=1` and `meta.total` — one cheap query rather
      // than a second shape bolted onto the list envelope. It asks without a
      // cursor, which is what makes the count present.
      return listed(
        reply,
        batch.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        {
          pageSize: query.pageSize,
          nextCursor: batch.nextCursor,
          hasMore: batch.hasMore,
          total: tally ? Number(tally[0]?.total ?? 0) : undefined,
        },
      );
    },
  );

  /**
   * One review, whole.
   *
   * The list is what a moderator scans; this is what they read before deciding,
   * so it holds every column of the row rather than the eight the table shows —
   * the moderation trail (`moderatedBy`, `moderatedAt`), the reply and when it
   * was sent, `helpfulCount`, and the ids linking it to a product, an account
   * and the order that made it a verified purchase. The images come with it
   * because a photograph is usually the reason a review is being looked at.
   *
   * `customerName` on the row is a snapshot taken when the review was written;
   * the joined `customer` is the account as it stands now, and the two are
   * allowed to disagree — a renamed or deleted account must not rewrite what a
   * review was signed with.
   */
  app.get(
    '/reviews/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('reviews.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db
        .select({
          review: reviews,
          productName: products.name,
          productSlug: products.slug,
          productStatus: products.status,
          orderNumber: orders.orderNumber,
          customerEmail: customers.email,
          customerStatus: customers.status,
        })
        .from(reviews)
        .innerJoin(products, eq(products.id, reviews.productId))
        .leftJoin(orders, eq(orders.id, reviews.orderId))
        .leftJoin(customers, eq(customers.id, reviews.customerId))
        .where(eq(reviews.id, id))
        .limit(1);

      if (!row) throw notFound('That review does not exist.');

      const images = await store.db
        .select()
        .from(reviewImages)
        .where(eq(reviewImages.reviewId, id))
        .orderBy(asc(reviewImages.createdAt));

      return ok(reply, {
        ...row.review,
        createdAt: row.review.createdAt.toISOString(),
        updatedAt: row.review.updatedAt.toISOString(),
        adminRepliedAt: row.review.adminRepliedAt?.toISOString() ?? null,
        moderatedAt: row.review.moderatedAt?.toISOString() ?? null,
        productName: row.productName,
        productSlug: row.productSlug,
        productStatus: row.productStatus,
        orderNumber: row.orderNumber,
        customerEmail: row.customerEmail,
        customerStatus: row.customerStatus,
        images: images.map((image) => ({ ...image, createdAt: image.createdAt.toISOString() })),
      });
    },
  );

  app.patch(
    '/reviews/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('reviews.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(moderateSchema, request.body);

      const updated = await store.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(reviews).where(eq(reviews.id, id)).limit(1);
        if (!existing) throw notFound('That review does not exist.');

        const [row] = await tx
          .update(reviews)
          .set({
            status: body.status,
            moderatedBy: request.storeAdmin!.adminId,
            moderatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reviews.id, id))
          .returning();

        await recomputeRating(tx, existing.productId);
        return row!;
      });

      await audit(store.db, request, {
        action: `review.${body.status}`,
        module: 'reviews',
        entity: 'review',
        entityId: id,
        entityLabel: updated.customerName,
        newValues: { status: updated.status },
      });

      return ok(reply, updated);
    },
  );

  /** The shop's public answer to a review. Shown beneath it on the storefront. */
  app.patch(
    '/reviews/:id/reply',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('reviews.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(replySchema, request.body);

      const [updated] = await store.db
        .update(reviews)
        .set({
          adminReply: body.adminReply,
          adminRepliedAt: body.adminReply ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(reviews.id, id))
        .returning({ id: reviews.id, adminReply: reviews.adminReply, adminRepliedAt: reviews.adminRepliedAt });

      if (!updated) throw notFound('That review does not exist.');

      return ok(reply, updated);
    },
  );

  app.delete(
    '/reviews/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('reviews.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      await store.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: reviews.id, productId: reviews.productId, customerName: reviews.customerName })
          .from(reviews)
          .where(eq(reviews.id, id))
          .limit(1);

        if (!existing) throw notFound('That review does not exist.');

        await tx.delete(reviewImages).where(eq(reviewImages.reviewId, id));
        await tx.delete(reviews).where(eq(reviews.id, id));
        await recomputeRating(tx, existing.productId);

        await audit(store.db, request, {
          action: 'review.delete',
          module: 'reviews',
          entity: 'review',
          entityId: id,
          entityLabel: existing.customerName,
        });
      });

      return noContent(reply);
    },
  );
}

/**
 * Rebuilds a product's rating from its approved reviews.
 *
 * Derived rather than accumulated, on purpose: a running counter has to be
 * adjusted correctly on approve, reject, edit and delete, and the first one that
 * is missed leaves a permanently wrong number that nothing detects.
 */
async function recomputeRating(tx: TenantExecutor, productId: string): Promise<void> {
  const [stats] = await tx
    .select({ average: avg(reviews.rating), total: count() })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, 'approved')));

  await tx
    .update(products)
    .set({
      ratingAverage: stats?.average ? Number(stats.average).toFixed(2) : '0',
      ratingCount: Number(stats?.total ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));
}
