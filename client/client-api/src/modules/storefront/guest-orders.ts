import type { FastifyReply, FastifyRequest } from 'fastify';
import { generateToken, sha256 } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import { readSessionToken, setOpaqueCookie } from '../../lib/session';
import { tenantKey } from '../../lib/cache';
import { addDays } from '../../lib/utils';
import type { StoreContext } from '../../plugins/tenant';

/** Long enough to come back to a receipt, short enough to be forgotten. */
const TTL_DAYS = 30;

function keyFor(tenantRef: string, token: string): string {
  return tenantKey(tenantRef, 'guest-orders', sha256(token));
}

/**
 * Lets a browser read back the orders it placed without an account.
 *
 * Checkout is a guest flow, but the confirmation page fetches the order through
 * the account endpoint — so without something like this a customer is bounced
 * off the receipt for the order they have just paid for.
 *
 * It is **not** a credential and grants nothing else: the token names specific
 * order numbers, only ever ones this browser created, and is stored as a SHA-256
 * exactly as a session token is. An order number alone is still not enough to
 * read an order, which is what keeps `ORD-20260812-0004` from being a way to
 * walk the shop's order book by incrementing a counter.
 */
export async function rememberGuestOrder(
  request: FastifyRequest,
  reply: FastifyReply,
  store: StoreContext,
  orderNumber: string,
): Promise<void> {
  const existing = readSessionToken(request, 'guestOrders');
  const token = existing ?? generateToken(32);
  const expiresAt = addDays(new Date(), TTL_DAYS);

  try {
    const key = keyFor(store.tenantRef, token);
    await redis.sadd(key, orderNumber);
    await redis.expire(key, TTL_DAYS * 24 * 60 * 60);
  } catch (error) {
    // The order exists either way; the worst case is a guest being asked to use
    // the track-order page instead. Never fail a paid checkout over a cache.
    logger.warn({ err: (error as Error).message }, 'could not record guest order');
    return;
  }

  // Re-set each time so the window slides with the customer's latest order.
  setOpaqueCookie(request, reply, 'guestOrders', token, expiresAt);
}

/** True when this browser is the one that placed the order. */
export async function guestOwnsOrder(
  request: FastifyRequest,
  store: StoreContext,
  orderNumber: string,
): Promise<boolean> {
  const token = readSessionToken(request, 'guestOrders');
  if (!token) return false;

  try {
    return (await redis.sismember(keyFor(store.tenantRef, token), orderNumber)) === 1;
  } catch (error) {
    // Fail closed: an unreachable cache must not become a way in.
    logger.warn({ err: (error as Error).message }, 'guest order lookup failed');
    return false;
  }
}
