import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerIdentities, customers } from '../../db/schema/index';
import { RATE_LIMITS } from '../../lib/constants';
import { AppError, ERROR_CODES, unauthorized } from '../../lib/errors';
import { ok, parseBody, parseQuery } from '../../lib/http';
import { googleAuthorizeUrl, googleEnabled, type GoogleProfile } from '../../lib/google-oauth';
import { consumeGoogleHandoff, saveOAuthState } from '../../lib/oauth-state';
import { enforce } from '../../lib/rate-limit';
import { createCustomerSession, setSessionCookie } from '../../lib/session';
import { storeBaseUrl } from '../../lib/urls';
import { storeOf, type StoreContext } from '../../plugins/tenant';
import { customerView } from './account.service';
import { issueRewardsQuietly } from '../discounts/rewards';

/**
 * Sign in with Google, from the store's side of the seam.
 *
 * Two routes, and between them sits a callback on the API's own hostname that
 * knows nothing about tenants (`modules/oauth/google.routes.ts`).
 *
 * - `start` mints the state that carries this store across that callback and
 *   hands back the URL to send the browser to. It does **not** redirect: the
 *   storefront calls it server-side and issues the redirect itself, because the
 *   browser must reach Google from the shop rather than from an API origin it
 *   has never seen.
 * - `exchange` spends the hand-off code the callback left behind. It runs here,
 *   under the store's own hostname, which is the whole reason for the two-step:
 *   the session cookie is scoped to the shop's domain and cannot be set from a
 *   response served by the API's.
 */

const startSchema = z.object({
  /** Where to land after signing in. A path only — see `safeNext`. */
  next: z.string().trim().max(512).optional(),
});

const exchangeSchema = z.object({ code: z.string().trim().min(20).max(200) });

export default async function googleAuthRoutes(app: FastifyInstance) {
  app.get('/auth/google/start', async (request, reply) => {
    const store = storeOf(request);
    if (!googleEnabled()) {
      throw new AppError(
        ERROR_CODES.FEATURE_NOT_IN_PLAN,
        'Signing in with Google is not available on this store.',
        503,
      );
    }

    const query = parseQuery(startSchema, request.query);
    await enforce(request, 'customer-google-start', RATE_LIMITS.login);

    const state = await saveOAuthState({
      tenantRef: store.tenantRef,
      slug: store.slug,
      returnOrigin: storefrontOrigin(store),
      next: safeNext(query.next),
    });

    return ok(reply, { url: googleAuthorizeUrl(state) });
  });

  app.post('/auth/google/exchange', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(exchangeSchema, request.body);
    await enforce(request, 'customer-google-exchange', RATE_LIMITS.login);

    const profile = await consumeGoogleHandoff(store.tenantRef, body.code);
    if (!profile) {
      throw unauthorized('That sign-in has expired. Please try again.', ERROR_CODES.INVALID_TOKEN);
    }

    const customer = await linkOrCreate(store, profile);

    if (customer.status === 'blocked') {
      throw unauthorized('Those details do not match an account.', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const session = await createCustomerSession(request, {
      customerId: customer.id,
      tenantRef: store.tenantRef,
    });
    setSessionCookie(request, reply, 'customer', session);

    return ok(reply, { customer: customerView(customer) });
  });
}

/**
 * The shop's own address, which is where the callback sends the browser back to.
 *
 * Read from the store record rather than from the request, and never from
 * anything the browser supplied: this string ends up in a `Location` header, so
 * a value off a query parameter would make the platform's Google callback into a
 * redirector anyone could aim wherever they liked.
 */
function storefrontOrigin(store: StoreContext): string {
  return store.primaryDomain ? `https://${store.primaryDomain}` : storeBaseUrl(store.slug);
}

/**
 * A path within the shop, or the account page.
 *
 * Anything that is not a single-slash-rooted path is discarded — `//evil.com`
 * included, which is a protocol-relative URL wearing a path's clothes and is the
 * one that gets missed. The storefront checks this again on arrival; both ends
 * do it because either alone would be the only thing standing between a sign-in
 * link and a phishing hop.
 */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account';
  return value;
}

type CustomerRow = typeof customers.$inferSelect;

/**
 * Finds the account this Google profile belongs to, or makes one.
 *
 * Three cases, in this order, and the order is the security of the whole thing.
 *
 * 1. **A linked identity** — matched on Google's `sub`, which never changes for
 *    a person and never moves to somebody else. This is the ordinary path and
 *    the only one that runs on a returning shopper.
 * 2. **An existing account with the same address**, linked on the spot. This is
 *    what stops a shopper who registered with a password and later presses the
 *    Google button from ending up with a second, empty account — but it is only
 *    reached when Google says `email_verified`. Without that flag the address is
 *    something the profile *claims*, and linking on a claim would let anyone who
 *    can create an account at an identity provider take over a shop account by
 *    naming its owner's email.
 * 3. **A new account.** No password is set, because there is nothing to set one
 *    from; the address is marked verified because Google verified it, and the
 *    shopper can add a password later from their account screen.
 */
async function linkOrCreate(store: StoreContext, profile: GoogleProfile): Promise<CustomerRow> {
  const linked = await store.db
    .select({ customer: customers })
    .from(customerIdentities)
    .innerJoin(customers, eq(customers.id, customerIdentities.customerId))
    .where(
      sql`${customerIdentities.provider} = 'google' and ${customerIdentities.subject} = ${profile.subject}`,
    )
    .limit(1);

  const existing = linked[0]?.customer;
  if (existing) {
    await store.db
      .update(customerIdentities)
      .set({ lastLoginAt: new Date(), email: profile.email })
      .where(
        sql`${customerIdentities.provider} = 'google' and ${customerIdentities.subject} = ${profile.subject}`,
      );

    await store.db
      .update(customers)
      .set({ lastLoginAt: new Date(), failedLoginCount: 0 })
      .where(eq(customers.id, existing.id));

    return existing;
  }

  if (profile.email && profile.emailVerified) {
    const byEmail = await store.db
      .select()
      .from(customers)
      .where(eq(sql`lower(${customers.email})`, profile.email))
      .limit(1);

    const match = byEmail[0];
    if (match) {
      await link(store, match.id, profile);

      await store.db
        .update(customers)
        .set({
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          // Google has proved the address; an account that signed up and never
          // clicked its own verification link is verified by this sign-in.
          emailVerifiedAt: match.emailVerifiedAt ?? new Date(),
        })
        .where(eq(customers.id, match.id));

      return match;
    }
  }

  const [created] = await store.db
    .insert(customers)
    .values({
      fullName: profile.fullName ?? profile.email?.split('@')[0] ?? 'Customer',
      email: profile.email,
      // Only ever stamped when Google actually said so; an unverified Google
      // address is stored as an address and not as a proved one.
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
      passwordHash: null,
      acceptsMarketing: false,
      lastLoginAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'That account could not be created.', 500);
  }

  await link(store, created.id, profile);
  await issueRewardsQuietly(store.db, created.id, 'registration');
  return created;
}

async function link(store: StoreContext, customerId: string, profile: GoogleProfile): Promise<void> {
  await store.db
    .insert(customerIdentities)
    .values({
      customerId,
      provider: 'google',
      subject: profile.subject,
      email: profile.email,
      lastLoginAt: new Date(),
    })
    .onConflictDoNothing({
      target: [customerIdentities.provider, customerIdentities.subject],
    });
}
