import 'fastify';
import type { StoreContext } from '../plugins/tenant';
import type { Permission, StoreRole } from '../lib/constants';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Resolved from the request hostname before any handler runs. Present on
     * every route except `/health` and `/api/v1/webhooks/*`.
     */
    store?: StoreContext;

    /** Present after `requireStoreAdmin` — a fully authenticated store admin. */
    storeAdmin?: {
      adminId: string;
      email: string;
      fullName: string;
      roleKey: StoreRole;
      sessionId: string;
      tenantRef: string;
      remember: boolean;
      mfaEnabled: boolean;
      authenticatedAt: Date;
      permissions: Set<Permission>;
    };

    /**
     * Present after `requireStoreAdminPartial` — an MFA challenge that has NOT
     * yet been completed. It can never satisfy `requireStoreAdmin`.
     */
    storeAdminPartial?: {
      adminId: string;
      email: string;
      sessionId: string;
      remember: boolean;
    };

    /** Raw request body, captured only for webhook signature verification. */
    rawBody?: string;
  }

  interface FastifyInstance {
    /** Full session + tenant pin + store health. */
    requireStoreAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** An unfinished MFA challenge only — used by `/auth/mfa/verify`. */
    requireStoreAdminPartial: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Session must have proved a password or TOTP within the reauth window. */
    requireReauth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Permission gate; a STORE_SUPER_ADMIN always passes. */
    requirePermission: (
      key: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Refuses anyone who is not a STORE_SUPER_ADMIN. */
    requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
