import Redis, { type RedisOptions } from 'ioredis';
import { config } from '../config/index';
import { logger } from './logger';

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 200, 3_000),
};

export const redis = new Redis(config.redis.url, baseOptions);

redis.on('error', (error: Error) => logger.error({ err: error.message }, 'redis error'));
redis.on('connect', () => logger.debug('redis connected'));

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connections, so queues and
 * workers get their own clients rather than sharing this one.
 */
export function createQueueConnection(): Redis {
  return new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * A connection that will be put into subscriber mode.
 *
 * ioredis refuses ordinary commands on a subscribed client, so a listener cannot
 * share `redis` above — it would break every `get` in the process. Retries are
 * unlimited on purpose: a subscriber that gives up stops hearing invalidations
 * and the caches it guards would go quietly stale.
 */
export function createSubscriber(): Redis {
  return new Redis(config.redis.url, {
    ...baseOptions,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit().catch(() => redis.disconnect());
}
