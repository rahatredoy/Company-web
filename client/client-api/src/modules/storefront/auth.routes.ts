import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerTokens, customers } from '../../db/schema/index';
import { RATE_LIMITS, TOKEN_TTL } from '../../lib/constants';
import { generateToken, sha256 } from '../../lib/crypto';
import { AppError, ERROR_CODES, unauthorized } from '../../lib/errors';
import { noContent, ok, parseBody } from '../../lib/http';
import { button, layout, paragraph, sendMail } from '../../lib/mailer';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password';
import { enforce, enforceDual } from '../../lib/rate-limit';
import {
  clearSessionCookie,
  createCustomerSession,
  findCustomerSession,
  readSessionToken,
  revokeAllCustomerSessions,
  revokeCustomerSession,
  setSessionCookie,
} from '../../lib/session';
import { storeUrl } from '../../lib/urls';
import { addMinutes } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';
import { customerView } from './account.service';

const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  email: emailField,
  phone: z.string().trim().max(24).optional(),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  acceptsTerms: z.literal(true, { message: 'Please accept the terms to continue.' }),
});

const loginSchema = z.object({ email: emailField, password: z.string().min(1).max(200) });

const forgotSchema = z.object({ email: emailField });

const resetSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

/**
 * Shopper accounts.
 *
 * A customer password is held to a lower bar than a store admin's — eight
 * characters rather than the panel's ten-plus-mixed-case — on purpose. This
 * credential unlocks an order history and an address book; the admin one unlocks
 * a business. Holding a shopper to the panel's rule mostly produces reused
 * passwords and abandoned carts.
 *
 * Nothing here tells an anonymous caller whether an address has an account. Sign
 * in answers the same way for an unknown email and a wrong password, and the
 * reset endpoint answers 204 either way.
 */
export default async function customerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(registerSchema, request.body);
    await enforceDual(request, 'customer-register', RATE_LIMITS.forgotPassword, body.email);

    const existing = await store.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(sql`lower(${customers.email})`, body.email))
      .limit(1);

    /*
     * This is the one place the platform does confirm an address is taken, and
     * it is unavoidable: a unique index means the alternative is a 500. The
     * message is deliberately about what to do next rather than about what
     * exists, and the endpoint is rate limited per address to keep it from being
     * walked.
     */
    if (existing.length > 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'That email address cannot be used.',
        409,
        { details: { email: ['Try signing in instead.'] } },
      );
    }

    const [created] = await store.db
      .insert(customers)
      .values({
        email: body.email,
        fullName: body.fullName,
        phone: body.phone || null,
        passwordHash: await hashPassword(body.password),
        acceptsMarketing: false,
      })
      .returning();

    const session = await createCustomerSession(store.db, request, {
      customerId: created!.id,
      tenantRef: store.tenantRef,
    });
    setSessionCookie(request, reply, 'customer', session);

    return ok(reply, { customer: customerView(created!) }, 201);
  });

  app.post('/auth/login', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(loginSchema, request.body);
    await enforceDual(request, 'customer-login', RATE_LIMITS.login, body.email);

    const rows = await store.db
      .select()
      .from(customers)
      .where(eq(sql`lower(${customers.email})`, body.email))
      .limit(1);

    const customer = rows[0];

    // One message and one shape for every failure below, so response body and
    // response time both stay silent about which accounts exist.
    const refuse = () =>
      unauthorized('Those details do not match an account.', ERROR_CODES.INVALID_CREDENTIALS);

    if (!customer || !customer.passwordHash) {
      await fakeVerify();
      throw refuse();
    }

    if (customer.status === 'blocked') {
      await fakeVerify();
      throw refuse();
    }

    if (!(await verifyPassword(customer.passwordHash, body.password))) throw refuse();

    await store.db
      .update(customers)
      .set({ lastLoginAt: new Date(), failedLoginCount: 0 })
      .where(eq(customers.id, customer.id));

    const session = await createCustomerSession(store.db, request, {
      customerId: customer.id,
      tenantRef: store.tenantRef,
    });
    setSessionCookie(request, reply, 'customer', session);

    return ok(reply, { customer: customerView(customer) });
  });

  /** Revokes the row as well as clearing the cookie — a cleared cookie alone
   *  leaves a token that still works if it was ever captured. */
  app.post('/auth/logout', async (request, reply) => {
    const store = storeOf(request);
    const token = readSessionToken(request, 'customer');

    if (token) {
      const session = await findCustomerSession(store.db, token);
      if (session) await revokeCustomerSession(store.db, session.id);
    }

    clearSessionCookie(request, reply, 'customer');
    return noContent(reply);
  });

  /**
   * Always 204, whether or not the address has an account — the response is the
   * only thing an attacker could read, so it says nothing.
   */
  app.post('/auth/forgot-password', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(forgotSchema, request.body);
    await enforceDual(request, 'customer-forgot', RATE_LIMITS.forgotPassword, body.email);

    const rows = await store.db
      .select({ id: customers.id, fullName: customers.fullName, email: customers.email })
      .from(customers)
      .where(eq(sql`lower(${customers.email})`, body.email))
      .limit(1);

    const customer = rows[0];

    if (customer) {
      const token = generateToken(32);

      // Any outstanding link is burned first, so a reset email always has
      // exactly one live token behind it.
      await store.db
        .update(customerTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(customerTokens.customerId, customer.id),
            eq(customerTokens.purpose, 'password_reset'),
            isNull(customerTokens.usedAt),
          ),
        );

      await store.db.insert(customerTokens).values({
        customerId: customer.id,
        tokenHash: sha256(token),
        purpose: 'password_reset',
        expiresAt: addMinutes(new Date(), TOKEN_TTL.passwordResetMinutes),
      });

      const url = storeUrl(store.slug, `/reset-password?token=${encodeURIComponent(token)}`);
      await sendMail({
        to: customer.email,
        fromName: store.storeName,
        subject: `Reset your ${store.storeName} password`,
        html: layout(
          store.storeName,
          'Reset your password',
          paragraph('Use the button below to choose a new password. The link works once and expires in an hour.') +
            button('Choose a new password', url) +
            paragraph('If you did not ask for this, you can ignore this email — nothing has changed.'),
        ),
        text: `Reset your password: ${url}`,
      });
    }

    return noContent(reply);
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(resetSchema, request.body);
    await enforce(request, 'customer-reset', RATE_LIMITS.forgotPassword);

    // Validate and burn in one statement: two simultaneous submissions of the
    // same link cannot both succeed.
    const [redeemed] = await store.db
      .update(customerTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(customerTokens.tokenHash, sha256(body.token)),
          eq(customerTokens.purpose, 'password_reset'),
          isNull(customerTokens.usedAt),
          sql`${customerTokens.expiresAt} > now()`,
        ),
      )
      .returning({ customerId: customerTokens.customerId });

    if (!redeemed) {
      throw unauthorized('That link has expired. Ask for a new one.', ERROR_CODES.INVALID_TOKEN);
    }

    await store.db
      .update(customers)
      .set({ passwordHash: await hashPassword(body.password), passwordChangedAt: new Date() })
      .where(eq(customers.id, redeemed.customerId));

    // Whoever else was signed in as this customer is signed out — a reset is
    // most often a response to someone else having the old password.
    await revokeAllCustomerSessions(store.db, redeemed.customerId);
    clearSessionCookie(request, reply, 'customer');

    return noContent(reply);
  });
}
