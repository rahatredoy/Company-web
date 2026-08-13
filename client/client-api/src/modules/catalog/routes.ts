import type { FastifyInstance } from 'fastify';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import brandRoutes from './brands.routes';
import categoryRoutes from './categories.routes';
import productRoutes from './products.routes';

/**
 * The catalogue: categories, brands and products.
 *
 * Registered as one unit because they are one thing to a store owner and
 * because products reference the other two, so a deployment that had products
 * without categories would be a half-catalogue nobody asked for.
 *
 * The hook is what makes a save show up on the shop. Everything the storefront
 * reads is cached in Redis for a minute or five, so without it the owner adds a
 * product, looks at their own website, sees nothing, and adds it again.
 */
export default async function catalogRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  await app.register(categoryRoutes);
  await app.register(brandRoutes);
  await app.register(productRoutes);
}
