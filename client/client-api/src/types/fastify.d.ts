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

    /**
     * Present after `requireCustomer` — a signed-in shopper.
     *
     * Carries no permissions, and is a separate field from `storeAdmin` on
     * purpose: a handler that reads the wrong one gets `undefined` rather than a
     * principal with the wrong authority.
     */
    customer?: {
      customerId: string;
      /** Null on an account that signed up with a phone number and added none. */
      email: string | null;
      fullName: string;
      sessionId: string;
      tenantRef: string;
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
    /** A signed-in shopper. Satisfied by no admin cookie, and vice versa. */
    requireCustomer: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Populates `request.customer` when signed in, and passes either way. */
    optionalCustomer: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
