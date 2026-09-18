import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import refundRoutes from './refunds.routes';
import adminReturnRoutes from './returns.routes';

/**
 * What happens to an order after it is delivered: taking it back, and paying
 * the money out again.
 *
 * One unit because they are one chain — a return that is completed raises a
 * refund. Registering them together means the cache hook is declared once for
 * both. There is no delivery charge and no shipping editor: an order's
 * progress is its status alone.
 */
export default async function fulfilmentRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  await app.register(adminReturnRoutes);
  await app.register(refundRoutes);
}
