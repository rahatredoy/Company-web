import { Worker, type Job } from 'bullmq';
import { createQueueConnection, closeRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { tenantDb } from '../db/tenant-manager';
import { QUEUE_NAMES, closeQueues, registerRepeatableJobs, type SweepJobData } from '../queues/index';
import { sweepSessions, sweepUsage } from '../services/tenant-sweep';

/**
 * Background worker for the commerce API. Runs as its own process
 * (`npm run worker`) so a sweep across every tenant can never sit in front of a
 * shopper's request.
 *
 * Concurrency is 1 on both queues on purpose: each sweep opens a connection per
 * store in turn, and running two of them at once would double that against the
 * same shards for no gain — the schedules are hours apart, not seconds.
 */
const workers: Worker[] = [];

function makeWorker<T>(name: string, handler: (job: Job<T>) => Promise<unknown>): Worker<T> {
  const worker = new Worker<T>(name, handler, { connection: createQueueConnection(), concurrency: 1 });

  worker.on('completed', (job) => logger.info({ queue: name, jobId: job.id }, 'job completed'));
  worker.on('failed', (job, error) =>
    logger.error({ queue: name, jobId: job?.id, err: error.message }, 'job failed'),
  );

  workers.push(worker as Worker);
  return worker;
}

async function main(): Promise<void> {
  makeWorker<SweepJobData>(QUEUE_NAMES.sessions, async () => sweepSessions());
  makeWorker<SweepJobData>(QUEUE_NAMES.usage, async () => sweepUsage());

  await registerRepeatableJobs();
  logger.info({ queues: Object.values(QUEUE_NAMES) }, 'commerce worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await Promise.all(workers.map((worker) => worker.close())).catch(() => undefined);
    await closeQueues();
    await tenantDb.closeAll().catch(() => undefined);
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'worker failed to start');
  process.exit(1);
});
