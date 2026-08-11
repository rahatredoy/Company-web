import type { FastifyInstance } from 'fastify';
import accountRoutes from './account.routes';
import onboardingRoutes from './onboarding.routes';
import storeRoutes from './store.routes';
import billingRoutes from './billing.routes';
import domainRoutes from './domains.routes';
import supportRoutes from './support.routes';

export default async function clientRoutes(app: FastifyInstance) {
  await app.register(accountRoutes);
  await app.register(onboardingRoutes);
  await app.register(storeRoutes);
  await app.register(billingRoutes);
  await app.register(domainRoutes);
  await app.register(supportRoutes);
}
