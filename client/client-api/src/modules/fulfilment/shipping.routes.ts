import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { shippingMethods, shippingZones } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { noContent, ok, parseBody, parseParams, uuidParamSchema } from '../../lib/http';
import { moneySchema } from '../../lib/validation';
import { storeOf } from '../../plugins/tenant';

const zoneSchema = z.object({
  name: z.string().trim().min(1, 'Give the zone a name.').max(120),
  countries: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
  cities: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

const methodSchema = z.object({
  zoneId: z.string().uuid('Choose a zone.'),
  name: z.string().trim().min(1, 'Give the option a name.').max(80),
  description: z.string().trim().max(200).nullable().default(null),
  price: moneySchema,
  freeAboveSubtotal: moneySchema.nullable().default(null),
  estimatedDaysMin: z.coerce.number().int().min(0).max(365).nullable().default(null),
  estimatedDaysMax: z.coerce.number().int().min(0).max(365).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * Where the store delivers, and what it charges.
 *
 * A zone that names no country and no city is the **catch-all**, and exactly one
 * zone may be the default — checkout falls back to it when nothing else matches,
 * so a store with none would quote nothing and be unable to take an order at
 * all. Deleting the last default is refused for the same reason.
 *
 * Rates are quoted to the customer from these rows and charged from them again
 * at checkout, which is why this sits under `orders.update` rather than a
 * settings permission: changing a price here changes what people pay.
 */
export default async function shippingRoutes(app: FastifyInstance) {
  app.get(
    '/shipping/zones',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.view')] },
    async (request, reply) => {
      const store = storeOf(request);

      const [zones, methods] = await Promise.all([
        store.db.select().from(shippingZones).orderBy(asc(shippingZones.sortOrder), asc(shippingZones.name)),
        store.db.select().from(shippingMethods).orderBy(asc(shippingMethods.sortOrder), asc(shippingMethods.price)),
      ]);

      return ok(
        reply,
        zones.map((zone) => ({
          ...zone,
          countries: zone.countries ?? [],
          cities: zone.cities ?? [],
          methods: methods.filter((method) => method.zoneId === zone.id),
        })),
      );
    },
  );

  app.post(
    '/shipping/zones',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(zoneSchema, request.body);

      const created = await store.db.transaction(async (tx) => {
        const existing = await tx.select({ id: shippingZones.id }).from(shippingZones).limit(1);
        const isDefault = body.isDefault || existing.length === 0;

        if (isDefault) await tx.update(shippingZones).set({ isDefault: false });

        const [row] = await tx.insert(shippingZones).values({ ...body, isDefault }).returning();
        return row!;
      });

      await audit(store.db, request, {
        action: 'shipping.zone.create',
        module: 'fulfilment',
        entity: 'shipping_zone',
        entityId: created.id,
        entityLabel: created.name,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.put(
    '/shipping/zones/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(zoneSchema, request.body);

      const updated = await store.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(shippingZones).where(eq(shippingZones.id, id)).limit(1);
        if (!existing) throw notFound('That zone does not exist.');

        // The catch-all cannot simply be switched off; another zone has to take
        // over first, or checkout stops being able to quote.
        if (existing.isDefault && !body.isDefault) {
          throw conflict('Make another zone the catch-all before turning this one off.');
        }

        if (body.isDefault) await tx.update(shippingZones).set({ isDefault: false });

        const [row] = await tx
          .update(shippingZones)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(shippingZones.id, id))
          .returning();

        return row!;
      });

      return ok(reply, updated);
    },
  );

  app.delete(
    '/shipping/zones/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [existing] = await store.db
        .select({ id: shippingZones.id, name: shippingZones.name, isDefault: shippingZones.isDefault })
        .from(shippingZones)
        .where(eq(shippingZones.id, id))
        .limit(1);

      if (!existing) throw notFound('That zone does not exist.');
      if (existing.isDefault) {
        throw conflict('This is the catch-all zone. Make another one the catch-all first.');
      }

      // Methods cascade; orders keep their own `shipping_method_label` snapshot,
      // so deleting a zone cannot rewrite what an old order was charged.
      await store.db.delete(shippingZones).where(eq(shippingZones.id, id));

      await audit(store.db, request, {
        action: 'shipping.zone.delete',
        module: 'fulfilment',
        entity: 'shipping_zone',
        entityId: id,
        entityLabel: existing.name,
      });

      return noContent(reply);
    },
  );

  app.post(
    '/shipping/methods',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(methodSchema, request.body);

      const [zone] = await store.db
        .select({ id: shippingZones.id })
        .from(shippingZones)
        .where(eq(shippingZones.id, body.zoneId))
        .limit(1);

      if (!zone) throw notFound('That zone does not exist.');

      const [created] = await store.db.insert(shippingMethods).values(body).returning();

      await audit(store.db, request, {
        action: 'shipping.method.create',
        module: 'fulfilment',
        entity: 'shipping_method',
        entityId: created!.id,
        entityLabel: created!.name,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.put(
    '/shipping/methods/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(methodSchema, request.body);

      const [updated] = await store.db
        .update(shippingMethods)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(shippingMethods.id, id))
        .returning();

      if (!updated) throw notFound('That delivery option does not exist.');

      return ok(reply, updated);
    },
  );

  app.delete(
    '/shipping/methods/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [removed] = await store.db
        .delete(shippingMethods)
        .where(eq(shippingMethods.id, id))
        .returning({ id: shippingMethods.id, name: shippingMethods.name });

      if (!removed) throw notFound('That delivery option does not exist.');

      const [left] = await store.db
        .select({ total: sql<number>`count(*)::int` })
        .from(shippingMethods)
        .where(eq(shippingMethods.isActive, true));

      await audit(store.db, request, {
        action: 'shipping.method.delete',
        module: 'fulfilment',
        entity: 'shipping_method',
        entityId: id,
        entityLabel: removed.name,
        newValues: { activeMethodsLeft: Number(left?.total ?? 0) },
      });

      return noContent(reply);
    },
  );
}
