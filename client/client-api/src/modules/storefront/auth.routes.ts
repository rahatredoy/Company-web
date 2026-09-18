import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerTokens, customers } from '../../db/schema/index';
import { RATE_LIMITS, TOKEN_TTL } from '../../lib/constants';
import { generateToken, sha256 } from '../../lib/crypto';
import { AppError, ERROR_CODES, conflict, unauthorized, unprocessable } from '../../lib/errors';
import { noContent, ok, parseBody } from '../../lib/http';
import { button, layout, paragraph, sendMail } from '../../lib/mailer';
import {
  OTP_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MINUTES,
  formatOtpForDisplay,
  generateOtp,
  resendWaitSeconds,
} from '../../lib/otp';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password';
import { maskPhone, toE164 } from '../../lib/phone';
import { enforce, enforceDual } from '../../lib/rate-limit';
import { sendSms } from '../../lib/sms';
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
import {
  consumeChallenge,
  consumeTicket,
  issueTicket,
  readChallenge,
  storeChallenge,
} from './phone-otp';
import { issueRewardsQuietly } from '../discounts/rewards';

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

/*
 * The number is taken as free text and normalised by `toE164`, not validated
 * into a shape here. A shopper types the number the way they dial it, and a
 * schema strict enough to be worth having would refuse spaces, dashes and the
 * leading zero every Bangladeshi number is written with.
 */
const phoneRequestSchema = z.object({ phone: z.string().trim().min(6).max(32) });

const phoneVerifySchema = z.object({
  phone: z.string().trim().min(6).max(32),
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^[0-9]{${OTP_LENGTH}}$`), 'Enter the six-digit code.'),
});

const phoneRegisterSchema = z.object({
  ticket: z.string().trim().min(20).max(200),
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  acceptsTerms: z.literal(true, { message: 'Please accept the terms to continue.' }),
});

/** One refusal for every unusable number, so the message never depends on why. */
const badPhone = () =>
  unprocessable('Enter a valid mobile number.', ERROR_CODES.VALIDATION_FAILED, {
    phone: ['Enter a valid mobile number.'],
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

    await issueRewardsQuietly(store.db, created!.id, 'registration');

    const session = await createCustomerSession(request, {
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

    const session = await createCustomerSession(request, {
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
      const session = await findCustomerSession(store.tenantRef, token);
      if (session) await revokeCustomerSession(store.tenantRef, session.id);
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

    /*
     * `customer.email` is re-checked rather than assumed from the lookup: the
     * column is nullable since phone sign-up, and `lower(null) = 'x'` is null
     * rather than true, so a row reaching here always has an address. The check
     * is what makes that legible to the next reader, and to the type system.
     */
    if (customer?.email) {
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
    await revokeAllCustomerSessions(store.tenantRef, redeemed.customerId);
    clearSessionCookie(request, reply, 'customer');

    return noContent(reply);
  });

  /**
   * Sign in with a phone number — which is also how an account is created with
   * one, because for a shopper holding a handset those are the same act.
   *
   * Three steps, and their order is the design.
   *
   * `request` sends a code and says **nothing** about whether the number has an
   * account. `verify` checks the code and only then reveals which it was: a
   * known number is signed in, an unknown one comes back as `name_required`
   * with a ticket. `register` spends that ticket.
   *
   * Asking for a name up front would have been one step shorter and would have
   * made the form an account-existence oracle — "what should we call you?" for a
   * stranger's number against "welcome back" for their neighbour's, answered
   * before anything at all had been proved. The email side is careful about this
   * everywhere except its unavoidable registration conflict; the phone side has
   * no such unavoidable case, so it gives nothing away.
   *
   * There is no password anywhere in this flow, and that is deliberate. A
   * password on top of a code the shopper must already receive adds a secret to
   * forget without adding a factor: both of them live on the same handset.
   */
  app.post('/auth/phone/request', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(phoneRequestSchema, request.body);

    const e164 = toE164(body.phone);
    if (!e164) throw badPhone();

    // Per IP *and* per number: the first stops one machine walking a range, the
    // second stops one handset being used as a doorbell from many machines.
    await enforceDual(request, 'customer-phone-request', RATE_LIMITS.forgotPassword, e164);

    /*
     * A resend inside the cooldown is answered exactly as a fresh send is, and
     * has to be: a distinguishable "too soon" would say that this number has a
     * code outstanding, which is the account-existence leak again by another
     * route. The one thing a shopper genuinely needs — how long to wait — is in
     * the response either way.
     */
    const outstanding = await readChallenge(store.tenantRef, e164);
    const wait = resendWaitSeconds(outstanding?.sentAt ?? null);

    if (wait === 0) {
      const code = generateOtp();
      await storeChallenge(store.tenantRef, e164, code);
      await sendSms({
        to: e164,
        body: `${formatOtpForDisplay(code)} is your ${store.storeName} sign-in code. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.`,
      });
    }

    return ok(reply, {
      sentTo: maskPhone(e164),
      resendInSeconds: wait === 0 ? OTP_RESEND_COOLDOWN_SECONDS : wait,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  });

  app.post('/auth/phone/verify', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(phoneVerifySchema, request.body);

    const e164 = toE164(body.phone);
    if (!e164) throw badPhone();

    await enforceDual(request, 'customer-phone-verify', RATE_LIMITS.login, e164);

    const outcome = await consumeChallenge(store.tenantRef, e164, body.code);
    if (outcome !== 'ok') {
      throw unauthorized(
        outcome === 'wrong' ? 'That code is not right.' : 'That code has expired. Ask for a new one.',
        outcome === 'wrong' ? ERROR_CODES.MFA_INVALID : ERROR_CODES.TOKEN_EXPIRED,
      );
    }

    const rows = await store.db
      .select()
      .from(customers)
      .where(eq(customers.phoneE164, e164))
      .limit(1);

    const customer = rows[0];

    // Proved, but unknown. The name is asked for next against a *ticket* rather
    // than against the number, so a browser cannot skip the code it just passed.
    if (!customer) {
      return ok(reply, {
        status: 'name_required' as const,
        ticket: await issueTicket(store.tenantRef, e164),
      });
    }

    if (customer.status === 'blocked') {
      throw unauthorized('Those details do not match an account.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    await store.db
      .update(customers)
      .set({
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        // Backfills the stamp for an account whose number predates this column;
        // a real one is never overwritten.
        phoneVerifiedAt: customer.phoneVerifiedAt ?? new Date(),
      })
      .where(eq(customers.id, customer.id));

    const session = await createCustomerSession(request, {
      customerId: customer.id,
      tenantRef: store.tenantRef,
    });
    setSessionCookie(request, reply, 'customer', session);

    return ok(reply, { status: 'signed_in' as const, customer: customerView(customer) });
  });

  app.post('/auth/phone/register', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(phoneRegisterSchema, request.body);
    await enforce(request, 'customer-phone-register', RATE_LIMITS.bulkWrite);

    const e164 = await consumeTicket(store.tenantRef, body.ticket);
    if (!e164) {
      throw unauthorized('That took too long. Start again with your number.', ERROR_CODES.INVALID_TOKEN);
    }

    /*
     * `onConflictDoNothing` rather than look-then-insert. Two tabs finishing this
     * form at the same moment would otherwise both find nothing, both insert, and
     * the unique index would turn the loser into a 500 on what is, from the
     * shopper's side, a successful sign-up. Here the loser simply finds the row
     * the winner wrote — which is their own account, since the number behind both
     * requests is the one they proved.
     */
    const [created] = await store.db
      .insert(customers)
      .values({
        fullName: body.fullName,
        email: null,
        phone: e164,
        phoneE164: e164,
        phoneVerifiedAt: new Date(),
        // No password, and no address to reset one against. The handset is the
        // credential; `passwordHash` stays null until they choose to add one.
        passwordHash: null,
        acceptsMarketing: false,
        lastLoginAt: new Date(),
      })
      .onConflictDoNothing({ target: customers.phoneE164 })
      .returning();

    const customer =
      created ??
      (await store.db.select().from(customers).where(eq(customers.phoneE164, e164)).limit(1))[0];

    // Only for the tab that actually created the account; the loser of the race found an existing one.
    if (created) await issueRewardsQuietly(store.db, created.id, 'registration');

    if (!customer) throw conflict('That number could not be registered.');
    if (customer.status === 'blocked') {
      throw unauthorized('Those details do not match an account.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const session = await createCustomerSession(request, {
      customerId: customer.id,
      tenantRef: store.tenantRef,
    });
    setSessionCookie(request, reply, 'customer', session);

    return ok(reply, { customer: customerView(customer) }, created ? 201 : 200);
  });
}
