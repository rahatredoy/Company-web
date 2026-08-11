import { Queue, type JobsOptions } from 'bullmq';
import { createQueueConnection } from '../lib/redis';
import { logger } from '../lib/logger';

export const QUEUE_NAMES = {
  provisioning: 'provisioning',
  notifications: 'notifications',
  trials: 'trials',
  domains: 'domains',
  billing: 'billing',
} as const;

export interface ProvisioningJobData {
  tenantId: string;
}

export interface DomainVerifyJobData {
  domainId: string;
}

export interface TrialSweepJobData {
  reason: 'scheduled' | 'manual';
}

export interface BillingSweepJobData {
  reason: 'scheduled' | 'manual';
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 86_400 },
};

let queues: {
  provisioning: Queue<ProvisioningJobData>;
  domains: Queue<DomainVerifyJobData>;
  trials: Queue<TrialSweepJobData>;
  billing: Queue<BillingSweepJobData>;
} | null = null;

/** Queues are created lazily so a Redis outage cannot block process start-up. */
function getQueues() {
  if (queues) return queues;
  const connection = createQueueConnection();

  queues = {
    provisioning: new Queue<ProvisioningJobData>(QUEUE_NAMES.provisioning, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    domains: new Queue<DomainVerifyJobData>(QUEUE_NAMES.domains, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    trials: new Queue<TrialSweepJobData>(QUEUE_NAMES.trials, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
    }),
    billing: new Queue<BillingSweepJobData>(QUEUE_NAMES.billing, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
    }),
  };

  return queues;
}

/**
 * Returns false instead of throwing when the queue is unavailable, so callers
 * can fall back to running the work inline.
 */
export async function queueProvisioning(tenantId: string): Promise<boolean> {
  try {
    await getQueues().provisioning.add('provision', { tenantId }, { jobId: `provision:${tenantId}` });
    return true;
  } catch (error) {
    logger.error({ err: (error as Error).message, tenantId }, 'failed to enqueue provisioning');
    return false;
  }
}

export async function queueDomainVerification(domainId: string, delayMs = 0): Promise<boolean> {
  try {
    await getQueues().domains.add('verify', { domainId }, { delay: delayMs, jobId: `domain:${domainId}:${delayMs}` });
    return true;
  } catch (error) {
    logger.error({ err: (error as Error).message, domainId }, 'failed to enqueue domain verification');
    return false;
  }
}

/**
 * Repeatable sweeps. Registered from the worker so the API process never owns a
 * schedule, and duplicate registration is harmless (same repeat key).
 */
export async function registerRepeatableJobs(): Promise<void> {
  const { trials, billing } = getQueues();

  // Job schedulers are keyed by id, so re-registering on every worker boot is
  // idempotent and never stacks duplicate schedules.
  await trials.upsertJobScheduler(
    'trials:sweep',
    { pattern: '0 * * * *' }, // hourly
    { name: 'sweep', data: { reason: 'scheduled' } },
  );

  await billing.upsertJobScheduler(
    'billing:sweep',
    { pattern: '15 * * * *' }, // hourly, offset
    { name: 'sweep', data: { reason: 'scheduled' } },
  );
}

export async function closeQueues(): Promise<void> {
  if (!queues) return;
  await Promise.all([
    queues.provisioning.close(),
    queues.domains.close(),
    queues.trials.close(),
    queues.billing.close(),
  ]).catch(() => undefined);
  queues = null;
}
