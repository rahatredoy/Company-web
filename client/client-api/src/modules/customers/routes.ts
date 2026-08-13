import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerAddresses, customers, orders } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'active', 'blocked']).default('all'),
  sort: z.enum(['createdAt', 'fullName', 'totalSpent']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const patchSchema = z.object({
  status: z.enum(['active', 'blocked']).optional(),
  adminNote: z.string().trim().max(4000).nullable().optional(),
  acceptsMarketing: z.boolean().optional(),
});

/**
 * The customer list.
 *
 * Read and annotate only. There is no create — an account is made by the person
 * it belongs to — and no delete, because order history points at these rows and
 * a shop that can erase a customer can erase its own books. Blocking is the
 * lever: it stops a sign-in without touching anything that was already bought.
 *
 * `password_hash`, `failed_login_count` and `locked_until` are never selected.
 * Staff have no reason to see them and a spread would eventually leak them.
 */
export default async function customerRoutes(app: FastifyInstance) {
  app.get(
    '/customers',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('customers.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(
              ilike(customers.fullName, `%${query.search}%`),
              ilike(customers.email, `%${query.search}%`),
              ilike(customers.phone, `%${query.search}%`),
            )
          : undefined,
        query.status === 'all' ? undefined : eq(customers.status, query.status),
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;
      const direction = query.order === 'asc' ? asc : desc;

      // Spend and order count come from `orders` rather than `customer_stats`,
      // which is a rollup nothing maintains yet — a figure that is stale is
      // worse than one that costs a subquery.
      const spent = sql<string>`(
        select coalesce(sum(o.grand_total), 0)::text from ${orders} o
        where o.customer_id = ${customers.id} and o.status not in ('cancelled', 'failed')
      )`;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: customers.id,
            fullName: customers.fullName,
            email: customers.email,
            phone: customers.phone,
            status: customers.status,
            customerType: customers.customerType,
            acceptsMarketing: customers.acceptsMarketing,
            createdAt: customers.createdAt,
            lastLoginAt: customers.lastLoginAt,
            orderCount: sql<number>`(
              select count(*)::int from ${orders} o where o.customer_id = ${customers.id}
            )`,
            totalSpent: spent,
          })
          .from(customers)
          .where(where)
          .orderBy(
            query.sort === 'totalSpent' ? direction(spent) : direction(customers[query.sort]),
          )
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),

        store.db.select({ total: count() }).from(customers).where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
          orderCount: Number(row.orderCount),
        })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
    },
  );

  app.get(
    '/customers/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('customers.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [customer] = await store.db
        .select({
          id: customers.id,
          fullName: customers.fullName,
          email: customers.email,
          phone: customers.phone,
          status: customers.status,
          customerType: customers.customerType,
          acceptsMarketing: customers.acceptsMarketing,
          emailVerifiedAt: customers.emailVerifiedAt,
          adminNote: customers.adminNote,
          createdAt: customers.createdAt,
          lastLoginAt: customers.lastLoginAt,
        })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);

      if (!customer) throw notFound('That customer does not exist.');

      const [customerOrders, addresses] = await Promise.all([
        store.db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            grandTotal: orders.grandTotal,
            currency: orders.currency,
            placedAt: orders.placedAt,
          })
          .from(orders)
          .where(eq(orders.customerId, id))
          .orderBy(desc(orders.placedAt))
          .limit(50),

        store.db.select().from(customerAddresses).where(eq(customerAddresses.customerId, id)),
      ]);

      return ok(reply, {
        ...customer,
        emailVerified: customer.emailVerifiedAt !== null,
        createdAt: customer.createdAt.toISOString(),
        lastLoginAt: customer.lastLoginAt?.toISOString() ?? null,
        orders: customerOrders.map((order) => ({ ...order, placedAt: order.placedAt.toISOString() })),
        addresses,
      });
    },
  );

  app.patch(
    '/customers/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('customers.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(patchSchema, request.body);

      const [existing] = await store.db
        .select({ id: customers.id, status: customers.status, email: customers.email })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);

      if (!existing) throw notFound('That customer does not exist.');

      const [updated] = await store.db
        .update(customers)
        .set({
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.adminNote === undefined ? {} : { adminNote: body.adminNote }),
          ...(body.acceptsMarketing === undefined ? {} : { acceptsMarketing: body.acceptsMarketing }),
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id))
        .returning({
          id: customers.id,
          status: customers.status,
          adminNote: customers.adminNote,
          acceptsMarketing: customers.acceptsMarketing,
        });

      /*
       * Blocking signs them out everywhere. Leaving a live session behind means
       * the block does not take effect until the cookie happens to expire, which
       * is the opposite of what whoever pressed it expected.
       */
      if (body.status === 'blocked' && existing.status !== 'blocked') {
        await store.db.execute(
          sql`update customer_sessions set revoked_at = now()
              where customer_id = ${id}::uuid and revoked_at is null`,
        );
      }

      await audit(store.db, request, {
        action: 'customer.update',
        module: 'customers',
        entity: 'customer',
        entityId: id,
        entityLabel: existing.email,
        oldValues: { status: existing.status },
        newValues: updated,
      });

      return ok(reply, updated);
    },
  );
}
