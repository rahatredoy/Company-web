import type { FastifyInstance } from 'fastify';
import accountRoutes from './account.routes';
import customerAuthRoutes from './auth.routes';
import checkoutRoutes from './checkout.routes';
import configRoutes from './config.routes';
import contentRoutes from './content.routes';
import homeRoutes from './home.routes';
import paymentRoutes from './payments.routes';
import storefrontOrderRoutes from './orders.routes';
import storefrontProductRoutes from './products.routes';
import storefrontReturnRoutes from './returns.routes';
import storefrontReviewRoutes from './reviews.routes';
import searchRoutes from './search.routes';
import taxonomyRoutes from './taxonomy.routes';

/**
 * The public storefront surface — what a customer's browser reaches.
 *
 * It has two halves, and the difference matters.
 *
 * **The catalogue half is unguarded, and therefore may never return an
 * unpublished row.** Those two facts are the same fact: the store admin session
 * is what separates the panel's view of a catalogue from a shopper's, and there
 * is no session on these routes, so the filter has to live in the query —
 * `PUBLISHED_PRODUCT`, `is_active`, `status = 'published'`, `status = 'approved'`.
 * `scripts/verify-storefront.ts` is what proves it still does.
 *
 * **The account half is guarded by `requireCustomer`**, a fourth cookie family
 * that satisfies none of the other three and carries no permissions at all.
 * Checkout sits between the two: `optionalCustomer` attaches a shopper when one
 * is signed in, because requiring an account in order to buy something is how a
 * shop loses the sale.
 *
 * The tenant is resolved before any of this runs, from the hostname alone — see
 * `plugins/tenant.ts`. `plugins/security.ts` treats every path that is not
 * `/api/v1/admin` as the storefront surface, so these routes get the storefront's
 * CORS origins and are refused to an admin-panel origin without naming
 * themselves anywhere in that plugin.
 */
export default async function storefrontRoutes(app: FastifyInstance) {
  await app.register(configRoutes);
  await app.register(homeRoutes);
  await app.register(taxonomyRoutes);
  await app.register(storefrontProductRoutes);
  await app.register(storefrontReviewRoutes);
  await app.register(searchRoutes);
  await app.register(contentRoutes);

  // The shopping half.
  await app.register(customerAuthRoutes);
  await app.register(accountRoutes);
  await app.register(storefrontOrderRoutes);
  await app.register(storefrontReturnRoutes);
  await app.register(checkoutRoutes);
  await app.register(paymentRoutes);
}
