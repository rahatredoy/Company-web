import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenantExecutor } from '../../db/tenant-manager';
import { customerAddresses, customers, orders, returnItems, returns } from '../../db/schema/index';
import { notFound } from '../../lib/errors';
import { noContent, ok, parseBody, parseParams, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { addressView, customerView } from './account.service';

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120).optional(),
  phone: z.string().trim().max(24).nullable().optional(),
  acceptsMarketing: z.boolean().optional(),
  /**
   * A real calendar date in the past. Checked as a date rather than a pattern,
   * because 2026-02-30 matches the pattern and a birthday offer would then look
   * for a day that never comes.
   */
  birthDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date like 1994-07-21.')
    .refine((value) => {
      const at = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value && at.getTime() < Date.now() && at.getUTCFullYear() >= 1900;
    }, 'Enter your real date of birth.')
    .nullable()
    .optional(),
});

const addressSchema = z.object({
  label: z.string().trim().max(40).nullable().default(null),
  fullName: z.string().trim().min(2, 'Enter a name.').max(120),
  phone: z.string().trim().min(6, 'Enter a phone number.').max(24),
  addressLine1: z.string().trim().min(3, 'Enter the street address.').max(200),
  addressLine2: z.string().trim().max(200).nullable().default(null),
  city: z.string().trim().min(2, 'Enter a city.').max(80),
  state: z.string().trim().max(80).nullable().default(null),
  postalCode: z.string().trim().max(20).nullable().default(null),
  country: z.string().trim().min(2, 'Choose a country.').max(80),
  isDefault: z.boolean().default(false),
});

/**
 * The signed-in shopper's own record.
 *
 * Everything here is scoped to `request.customer.customerId` in the WHERE clause
 * rather than checked after the read. A route that fetched by id and then
 * compared owners is one early return away from being an enumeration hole; a
 * route that never selects another customer's row cannot be.
 */
export default async function accountRoutes(app: FastifyInstance) {
  /**
   * Deliberately **not** guarded, and deliberately 404 rather than 401 when
   * signed out.
   *
   * The storefront's `/account` layout calls this and redirects to sign-in on a
   * null answer, using `allowNotFound`. A 401 would be thrown as an error and
   * take out the page instead of redirecting — the same mistake that made the
   * company panel loop on its own login screen.
   */
  app.get('/account/me', { preHandler: [app.optionalCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    if (!request.customer) throw notFound('Not signed in.');

    const [row] = await store.db
      .select()
      .from(customers)
      .where(eq(customers.id, request.customer.customerId))
      .limit(1);

    if (!row) throw notFound('Not signed in.');

    return ok(reply, customerView(row));
  });

  /** Email is not editable here — changing it is a separately verified flow. */
  app.put('/account/me', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(profileSchema, request.body);
    const customerId = request.customer!.customerId;

    const [updated] = await store.db
      .update(customers)
      .set({
        ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.acceptsMarketing === undefined ? {} : { acceptsMarketing: body.acceptsMarketing }),
        ...(body.birthDate === undefined ? {} : { birthDate: body.birthDate }),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId))
      .returning();

    if (!updated) throw notFound('Not signed in.');

    return ok(reply, customerView(updated));
  });

  app.get('/account/addresses', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);

    const rows = await store.db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, request.customer!.customerId))
      .orderBy(desc(customerAddresses.isDefault), asc(customerAddresses.createdAt));

    return ok(reply, rows.map(addressView));
  });

  app.post('/account/addresses', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(addressSchema, request.body);
    const customerId = request.customer!.customerId;

    const created = await store.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(eq(customerAddresses.customerId, customerId))
        .limit(1);

      // The first address is the default whatever the request said — an address
      // book where nothing is default makes checkout pick arbitrarily.
      const isDefault = body.isDefault || existing.length === 0;
      if (isDefault) await clearDefault(tx, customerId);

      const [row] = await tx
        .insert(customerAddresses)
        .values({ ...body, customerId, isDefault })
        .returning();

      return row!;
    });

    return ok(reply, addressView(created), 201);
  });

  app.put('/account/addresses/:id', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);
    const body = parseBody(addressSchema, request.body);
    const customerId = request.customer!.customerId;

    const updated = await store.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)))
        .limit(1);

      if (!owned) return null;

      if (body.isDefault) await clearDefault(tx, customerId, id);

      const [row] = await tx
        .update(customerAddresses)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)))
        .returning();

      return row ?? null;
    });

    if (!updated) throw notFound('That address does not exist.');

    return ok(reply, addressView(updated));
  });

  app.delete('/account/addresses/:id', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(uuidParamSchema, request.params);
    const customerId = request.customer!.customerId;

    const [removed] = await store.db
      .delete(customerAddresses)
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customerId)))
      .returning({ id: customerAddresses.id, wasDefault: customerAddresses.isDefault });

    if (!removed) throw notFound('That address does not exist.');

    // Deleting the default promotes the next one rather than leaving the book
    // with no default at all.
    if (removed.wasDefault) {
      const [next] = await store.db
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(eq(customerAddresses.customerId, customerId))
        .orderBy(asc(customerAddresses.createdAt))
        .limit(1);

      if (next) {
        await store.db
          .update(customerAddresses)
          .set({ isDefault: true })
          .where(eq(customerAddresses.id, next.id));
      }
    }

    return noContent(reply);
  });

  app.get('/account/returns', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);

    const rows = await store.db
      .select({
        id: returns.id,
        returnNumber: returns.returnNumber,
        orderNumber: orders.orderNumber,
        status: returns.status,
        resolution: returns.resolution,
        requestedAt: returns.createdAt,
        itemCount: sql<number>`(
          select coalesce(sum(ri.quantity), 0)::int
          from ${returnItems} ri where ri.return_id = ${returns.id}
        )`,
      })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .where(eq(returns.customerId, request.customer!.customerId))
      .orderBy(desc(returns.createdAt));

    return ok(
      reply,
      rows.map((row) => ({
        id: row.id,
        returnNumber: row.returnNumber,
        orderNumber: row.orderNumber,
        status: row.status,
        resolution: row.resolution,
        requestedAt: row.requestedAt.toISOString(),
        itemCount: Number(row.itemCount),
      })),
    );
  });
}

/**
 * Exactly one default address per customer.
 *
 * Enforced here rather than by an index because Postgres has no partial-unique
 * that expresses "at most one true per customer" without a filtered index the
 * schema does not carry — so every write path that can set a default has to
 * clear the others first, in the same transaction.
 */
async function clearDefault(
  tx: TenantExecutor,
  customerId: string,
  exceptId?: string,
): Promise<void> {
  const conditions = [eq(customerAddresses.customerId, customerId), eq(customerAddresses.isDefault, true)];
  if (exceptId) conditions.push(ne(customerAddresses.id, exceptId));
  await tx.update(customerAddresses).set({ isDefault: false }).where(and(...conditions));
}
