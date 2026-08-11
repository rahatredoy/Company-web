import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present after `requireClient` or `requireClientPartial`. */
    clientAuth?: {
      accountId: string;
      email: string;
      fullName: string;
      sessionId: string;
      onboardingCompleted: boolean;
      /** False on a `requireClientPartial` session still awaiting its passcode. */
      otpVerified: boolean;
      remember: boolean;
      /** As it was *before* this request touched it — drives the cookie refresh. */
      lastSeenAt: Date;
    };
    /** Present after `requireAdmin`. */
    adminAuth?: {
      adminId: string;
      email: string;
      sessionId: string;
      otpVerified: boolean;
      authenticatedAt: Date;
    };
    /** Raw request body, captured only for webhook signature verification. */
    rawBody?: string;
  }
}
