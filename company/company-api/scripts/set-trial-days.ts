/**
 * Changes the platform trial length on a database that has already been seeded.
 *
 *   npx tsx scripts/set-trial-days.ts            # applies the built-in default
 *   npx tsx scripts/set-trial-days.ts --days 7
 *   npx tsx scripts/set-trial-days.ts --days 7 --reminders 3,1
 *
 * `db:seed` only ever *creates* the settings groups — it never overwrites one,
 * so an installation seeded before the default changed keeps its old value until
 * this runs (or an admin edits it in the company panel). Trials already running
 * keep the length they started with; this sets the length new ones get.
 */
import { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_REMINDER_DAYS } from '../src/lib/constants';
import { getTrialSettings, updateSettings } from '../src/lib/settings';
import { redis } from '../src/lib/redis';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const daysArg = flag('days');
  const days = daysArg === undefined ? DEFAULT_TRIAL_DAYS : Number(daysArg);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('--days must be a whole number between 1 and 365.');
  }

  const remindersArg = flag('reminders');
  const reminderDays = remindersArg
    ? remindersArg
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    : DEFAULT_TRIAL_REMINDER_DAYS.filter((value) => value < days);

  const before = await getTrialSettings();
  const after = (await updateSettings({ trial: { trialDays: days, reminderDays } })).trial;

  console.log(`\n  trial days   ${before.trialDays} → ${after.trialDays}`);
  console.log(`  reminders    [${before.reminderDays.join(', ')}] → [${after.reminderDays.join(', ')}]\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
