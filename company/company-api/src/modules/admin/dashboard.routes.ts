import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { activityEvents, clientBusinessProfiles, tenants } from '../../db/schema/index';
import { buildMeta, ok, paginated, parseParams, parseQuery, paginationSchema, uuidParamSchema } from '../../lib/http';
import { buildCharts, buildDashboard, resolveRange, supportCounts, type RangeKey } from '../../services/dashboard';

/**
 * Accepts either an ISO datetime or a plain `YYYY-MM-DD` from a date input.
 * The UI's native date picker produces the latter.
 */
const dateInput = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Enter a valid date.')
  .transform((value) => new Date(value).toISOString());

const rangeSchema = z.object({
  range: z.enum(['7d', '30d', '3m', '6m', '1y', 'custom']).default('30d'),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export default async function adminDashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(rangeSchema, request.query);
    const window = resolveRange(query.range as RangeKey, query.from, query.to);
    return ok(reply, await buildDashboard(window));
  });

  app.get('/dashboard/charts', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(rangeSchema, request.query);
    const window = resolveRange(query.range as RangeKey, query.from, query.to);
    return ok(reply, await buildCharts(window));
  });

  /** Small badge count for the topbar. */
  app.get('/support/counts', { preHandler: app.requireAdmin }, async (_request, reply) => {
    return ok(reply, await supportCounts());
  });

  // --- Notification feed ------------------------------------------------------

  /**
   * Platform events for the admin bell. Backed by `activity_events`, which is
   * already written by provisioning, billing, trials and support — this just
   * adds read state on top.
   */
  app.get('/notifications', { preHandler: app.requireAdmin }, async (request, reply) => {
    const query = parseQuery(
      paginationSchema.extend({ unreadOnly: z.coerce.boolean().default(false) }),
      request.query,
    );

    const where = query.unreadOnly ? isNull(activityEvents.readAt) : undefined;

    const base = db
      .select({
        event: activityEvents,
        businessName: clientBusinessProfiles.businessName,
        tenantRef: tenants.tenantRef,
      })
      .from(activityEvents)
      .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, activityEvents.clientAccountId))
      .leftJoin(tenants, eq(tenants.id, activityEvents.tenantId));

    const [rows, totals, unread] = await Promise.all([
      (where ? base.where(where) : base)
        .orderBy(desc(activityEvents.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      where
        ? db.select({ total: count() }).from(activityEvents).where(where)
        : db.select({ total: count() }).from(activityEvents),
      db.select({ total: count() }).from(activityEvents).where(isNull(activityEvents.readAt)),
    ]);

    return paginated(
      reply,
      rows.map((row) => ({
        id: row.event.id,
        type: row.event.type,
        title: row.event.title,
        subject: row.event.subject,
        clientId: row.event.clientAccountId,
        businessName: row.businessName,
        tenantId: row.tenantRef,
        metadata: row.event.metadata,
        read: row.event.readAt !== null,
        createdAt: row.event.createdAt,
      })),
      {
        ...buildMeta(query.page, query.pageSize, Number(totals[0]?.total ?? 0)),
        // Piggy-backed so the bell badge and the list stay in sync in one call.
        unread: Number(unread[0]?.total ?? 0),
      } as never,
    );
  });

  app.post('/notifications/:id/read', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = parseParams(uuidParamSchema, request.params);
    await db
      .update(activityEvents)
      .set({ readAt: new Date() })
      .where(and(eq(activityEvents.id, id), isNull(activityEvents.readAt)));
    return ok(reply, { read: true });
  });

  app.post('/notifications/read-all', { preHandler: app.requireAdmin }, async (_request, reply) => {
    await db.update(activityEvents).set({ readAt: new Date() }).where(isNull(activityEvents.readAt));
    return ok(reply, { read: true });
  });

  app.get('/notifications/counts', { preHandler: app.requireAdmin }, async (_request, reply) => {
    const rows = await db.select({ total: count() }).from(activityEvents).where(isNull(activityEvents.readAt));
    return ok(reply, { unread: Number(rows[0]?.total ?? 0) });
  });
}
