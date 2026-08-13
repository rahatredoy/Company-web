import { and, asc, avg, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { products, reviewImages, reviews } from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
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
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;
      const direction = query.order === 'asc' ? asc : desc;

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
          .where(where)
          .orderBy(direction(reviews[query.sort]))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),

        store.db
          .select({ total: count() })
          .from(reviews)
          .innerJoin(products, eq(products.id, reviews.productId))
          .where(where),
      ]);

      // A pending count for the queue badge comes from this same endpoint with
      // `?status=pending&pageSize=1` and `meta.total` — one cheap query rather
      // than a second shape bolted onto the pagination envelope.
      return paginated(
        reply,
        rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
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
