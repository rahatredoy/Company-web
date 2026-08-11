import type { FastifyRequest } from 'fastify';
import { redis } from './redis';
import { rateLimited } from './errors';
import { clientIp } from './http';
import { logger } from './logger';

export interface RateLimitRule {
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in Redis. Cheap, and enough for the abuse we care about
 * here (credential stuffing, verification-email spam, checkout hammering).
 */
export async function consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, rule.windowSeconds);

    const ttl = count > rule.max ? await redis.ttl(redisKey) : rule.windowSeconds;
    return {
      allowed: count <= rule.max,
      remaining: Math.max(0, rule.max - count),
      retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds,
    };
  } catch (error) {
    // If Redis is down we fail open rather than locking every user out, but we
    // make the outage loud.
    logger.error({ err: (error as Error).message, key }, 'rate limiter unavailable');
    return { allowed: true, remaining: rule.max, retryAfterSeconds: 0 };
  }
}

export async function enforce(
  request: FastifyRequest,
  scope: string,
  rule: RateLimitRule,
  identifier?: string,
): Promise<void> {
  const key = `${scope}:${identifier ?? clientIp(request)}`;
  const result = await consume(key, rule);
  if (!result.allowed) {
    request.log.warn({ scope, identifier: identifier ?? 'ip' }, 'rate limit exceeded');
    throw rateLimited(`Too many attempts. Try again in ${result.retryAfterSeconds} seconds.`);
  }
}

/** Applies both an IP limit and a per-identity limit (email, account id, …). */
export async function enforceDual(
  request: FastifyRequest,
  scope: string,
  rule: RateLimitRule,
  identity: string,
): Promise<void> {
  await enforce(request, `${scope}:ip`, rule);
  await enforce(request, `${scope}:id`, rule, identity.toLowerCase());
}

export async function reset(scope: string, identifier: string): Promise<void> {
  await redis.del(`rl:${scope}:${identifier}`).catch(() => undefined);
}
