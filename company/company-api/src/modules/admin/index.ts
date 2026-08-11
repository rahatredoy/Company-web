import type { FastifyInstance } from 'fastify';
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import clientRoutes from './clients.routes';
import catalogRoutes from './catalog.routes';
import platformRoutes from './platform.routes';

export default async function adminRoutes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(clientRoutes);
  await app.register(catalogRoutes);
  await app.register(platformRoutes);
}
