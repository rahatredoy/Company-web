import { Queue, type JobsOptions } from 'bullmq';
import { createQueueConnection } from '../lib/redis';
import { logger } from '../lib/logger';

/**
 * Background work for the commerce API.
 *
 * Everything here is a *sweep* rather than a reaction to one request: the work
 * this side defers is periodic housekeeping across every tenant, not a slow step
 * inside a checkout. Requests stay synchronous on purpose — a shopper who has
 * paid must be told so by the response that took the payment, not by a job.
 */
export const QUEUE_NAMES = {
  /** Deletes sessions that can no longer authenticate, in every tenant. */
  sessions: 'commerce-sessions',
  /** Reports product/admin/storage counts to the control plane. */
  usage: 'commerce-usage',
} as const;

export interface SweepJobData {
  reason: 'scheduled' | 'manual';
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  // A sweep runs again on the next tick anyway, so a failure is not worth
  // retrying — a retry storm against a shard that is down helps nobody.
  attempts: 1,
  removeOnComplete: { age: 3_600, count: 200 },
  removeOnFail: { age: 86_400 },
};

let queues: {
  sessions: Queue<SweepJobData>;
  usage: Queue<SweepJobData>;
} | null = null;

/** Queues are created lazily so a Redis outage cannot block process start-up. */
function getQueues() {
  if (queues) return queues;
  const connection = createQueueConnection();

  queues = {
    sessions: new Queue<SweepJobData>(QUEUE_NAMES.sessions, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    usage: new Queue<SweepJobData>(QUEUE_NAMES.usage, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  };

  return queues;
}

/**
 * Repeatable sweeps. Registered from the worker so the API process never owns a
 * schedule, and duplicate registration is harmless (same scheduler id).
 */
export async function registerRepeatableJobs(): Promise<void> {
  const { sessions, usage } = getQueues();

  await sessions.upsertJobScheduler(
    'commerce:sessions:sweep',
    { pattern: '30 * * * *' }, // hourly, offset from the company sweeps
    { name: 'sweep', data: { reason: 'scheduled' } },
  );

  await usage.upsertJobScheduler(
    'commerce:usage:sweep',
    { pattern: '45 */6 * * *' }, // every six hours — plan limits do not move quickly
    { name: 'sweep', data: { reason: 'scheduled' } },
  );
}

/** Runs a sweep now, for the command line. Returns false if the queue is unreachable. */
export async function queueSweep(queue: keyof typeof QUEUE_NAMES): Promise<boolean> {
  try {
    await getQueues()[queue].add('sweep', { reason: 'manual' });
    return true;
  } catch (error) {
    logger.error({ err: (error as Error).message, queue }, 'failed to enqueue sweep');
    return false;
  }
}

export async function closeQueues(): Promise<void> {
  if (!queues) return;
  await Promise.all([queues.sessions.close(), queues.usage.close()]).catch(() => undefined);
  queues = null;
}
