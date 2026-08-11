import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createQueueConnection, closeRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { closeDatabase, db } from '../db/client';
import { domains } from '../db/schema/index';
import { checkDomain } from '../lib/dns';
import {
  QUEUE_NAMES,
  closeQueues,
  registerRepeatableJobs,
  type DomainVerifyJobData,
  type ProvisioningJobData,
} from '../queues/index';
import { runProvisioning } from '../services/provisioning';
import { sweepBilling, sweepTrials } from '../services/trial-sweep';
import { purgeExpiredSessions } from '../lib/session';

/**
 * Background worker. Runs as its own process (`npm run worker`) so a slow job
 * can never block an HTTP request.
 */
const workers: Worker[] = [];

function makeWorker<T>(name: string, handler: (job: Job<T>) => Promise<unknown>, concurrency = 2): Worker<T> {
  const worker = new Worker<T>(name, handler, { connection: createQueueConnection(), concurrency });

  worker.on('completed', (job) => logger.info({ queue: name, jobId: job.id }, 'job completed'));
  worker.on('failed', (job, error) =>
    logger.error({ queue: name, jobId: job?.id, err: error.message }, 'job failed'),
  );

  workers.push(worker as Worker);
  return worker;
}

async function main(): Promise<void> {
  makeWorker<ProvisioningJobData>(QUEUE_NAMES.provisioning, async (job) => {
    const result = await runProvisioning(job.data.tenantId);
    // Throwing lets BullMQ retry with backoff; the job itself is idempotent.
    if (result.status === 'failed') throw new Error(result.error ?? 'Provisioning failed.');
    return result;
  });

  makeWorker<DomainVerifyJobData>(QUEUE_NAMES.domains, async (job) => {
    const rows = await db.select().from(domains).where(eq(domains.id, job.data.domainId)).limit(1);
    const domain = rows[0];
    if (!domain || !domain.verificationToken) return { skipped: true };

    const result = await checkDomain(domain.domain, domain.verificationToken);
    const now = new Date();

    await db
      .update(domains)
      .set({
        verified: result.ownershipVerified,
        status: result.ownershipVerified ? 'active' : 'pending',
        verifiedAt: result.ownershipVerified ? now : null,
        lastCheckedAt: now,
        lastError: result.ownershipVerified ? null : (result.error ?? 'Verification record not found.'),
        updatedAt: now,
      })
      .where(eq(domains.id, domain.id));

    return { verified: result.ownershipVerified };
  });

  makeWorker(QUEUE_NAMES.trials, async () => {
    const result = await sweepTrials();
    await purgeExpiredSessions();
    return result;
  }, 1);

  makeWorker(QUEUE_NAMES.billing, async () => sweepBilling(), 1);

  await registerRepeatableJobs();
  logger.info({ queues: Object.values(QUEUE_NAMES) }, 'worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await Promise.all(workers.map((worker) => worker.close())).catch(() => undefined);
    await closeQueues();
    await closeRedis();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'worker failed to start');
  process.exit(1);
});
