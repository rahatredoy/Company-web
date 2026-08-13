/**
 * Runs a housekeeping sweep across every store, now.
 *
 *   npx tsx scripts/run-sweep.ts sessions      delete sessions that can no longer authenticate
 *   npx tsx scripts/run-sweep.ts usage         report product/admin/storage counts upstream
 *   npx tsx scripts/run-sweep.ts all
 *   npx tsx scripts/run-sweep.ts sessions --queue    hand it to the worker instead
 *
 * By default the work happens in this process, so the result is visible here.
 * `--queue` enqueues it for `npm run worker` instead, which is what a scheduled
 * run does — useful for checking the worker is actually consuming.
 */
import { closeRedis } from '../src/lib/redis';
import { closeQueues, queueSweep } from '../src/queues/index';
import { sweepSessions, sweepUsage } from '../src/services/tenant-sweep';
import { tenantDb } from '../src/db/tenant-manager';

const SWEEPS = {
  sessions: sweepSessions,
  usage: sweepUsage,
} as const;

type SweepName = keyof typeof SWEEPS;

function parseNames(argv: string[]): SweepName[] {
  const asked = argv.filter((value) => !value.startsWith('--'));
  if (!asked.length || asked.includes('all')) return Object.keys(SWEEPS) as SweepName[];

  const names = asked.filter((value): value is SweepName => value in SWEEPS);
  if (names.length !== asked.length) {
    const unknown = asked.filter((value) => !(value in SWEEPS));
    console.error(`Unknown sweep(s): ${unknown.join(', ')}. Known: ${Object.keys(SWEEPS).join(', ')}`);
    process.exit(1);
  }
  return names;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const names = parseNames(argv);
  const viaQueue = argv.includes('--queue');

  for (const name of names) {
    if (viaQueue) {
      const queued = await queueSweep(name);
      console.log(`  ${name.padEnd(10)} ${queued ? 'queued for the worker' : 'COULD NOT QUEUE — is Redis up?'}`);
      continue;
    }

    const started = Date.now();
    const result = await SWEEPS[name]();
    console.log(
      `  ${name.padEnd(10)} ${result.visited} store(s) visited, ${result.skipped} not ready, ` +
        `${result.failed} failed  ${JSON.stringify(result.detail)}  ${Date.now() - started}ms`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues().catch(() => undefined);
    await tenantDb.closeAll().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
