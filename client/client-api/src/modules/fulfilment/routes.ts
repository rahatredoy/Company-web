import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import refundRoutes from './refunds.routes';
import adminReturnRoutes from './returns.routes';
import shippingRoutes from './shipping.routes';

/**
 * Everything that happens to an order after it is placed: getting it there,
 * taking it back, and paying the money out again.
 *
 * One unit because they are one chain — a return that is completed raises a
 * refund, and both depend on the shipping rows that priced the order in the
 * first place. Registering them together means the cache hook is declared once
 * for all three, and a shipping change reaches checkout's quote immediately
 * rather than at the end of a TTL.
 */
export default async function fulfilmentRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  await app.register(shippingRoutes);
  await app.register(adminReturnRoutes);
  await app.register(refundRoutes);
}
