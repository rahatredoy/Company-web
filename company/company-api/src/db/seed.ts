/**
 * Seeds the four launch plans, the default settings and the single company
 * admin. Safe to re-run: every insert is guarded by an existence check and no
 * existing row is overwritten.
 */
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from './client';
import { companyAdmin, plans, systemSettings } from './schema/index';
import { config } from '../config/index';
import { hashPassword } from '../lib/password';
import { DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_REMINDER_DAYS } from '../lib/constants';

const PLANS = [
  /**
   * The trial is a plan, not a discount on the others: one card, taken once per
   * account for life, priced 0.00 on both cycles. It carries the premium
   * feature set on purpose — a trial that cannot show what is being sold sells
   * nothing — and its length comes from the trial setting, never from here.
   */
  {
    name: 'Free Trial',
    code: 'free-trial',
    description: 'Try the premium features free, once',
    monthlyPrice: '0.00',
    yearlyPrice: '0.00',
    productLimit: 2000,
    adminLimit: 5,
    storageLimitMb: 51200,
    customDomainEnabled: true,
    customAdminDomainEnabled: true,
    analyticsEnabled: true,
    reportsEnabled: true,
    supportLevel: 'priority' as const,
    isFeatured: false,
    isTrial: true,
    sortOrder: 0,
  },
  {
    name: 'Starter',
    code: 'starter',
    description: 'Perfect for beginners',
    monthlyPrice: '19.00',
    yearlyPrice: '182.00',
    productLimit: 100,
    adminLimit: 1,
    storageLimitMb: 5120,
    customDomainEnabled: true,
    customAdminDomainEnabled: false,
    analyticsEnabled: false,
    reportsEnabled: false,
    supportLevel: 'email' as const,
    isFeatured: false,
    sortOrder: 1,
  },
  {
    name: 'Business',
    code: 'business',
    description: 'For growing businesses',
    monthlyPrice: '39.00',
    yearlyPrice: '372.00',
    productLimit: 500,
    adminLimit: 3,
    storageLimitMb: 20480,
    customDomainEnabled: true,
    customAdminDomainEnabled: false,
    analyticsEnabled: true,
    reportsEnabled: true,
    supportLevel: 'priority' as const,
    isFeatured: true,
    sortOrder: 2,
  },
  {
    name: 'Professional',
    code: 'professional',
    description: 'Advanced for professionals',
    monthlyPrice: '79.00',
    yearlyPrice: '756.00',
    productLimit: 2000,
    adminLimit: 5,
    storageLimitMb: 51200,
    customDomainEnabled: true,
    customAdminDomainEnabled: true,
    analyticsEnabled: true,
    reportsEnabled: true,
    supportLevel: 'priority' as const,
    isFeatured: false,
    sortOrder: 3,
  },
  {
    name: 'Enterprise',
    code: 'enterprise',
    description: 'For large scale business',
    monthlyPrice: '199.00',
    yearlyPrice: '1908.00',
    productLimit: null,
    adminLimit: null,
    storageLimitMb: 204800,
    customDomainEnabled: true,
    customAdminDomainEnabled: true,
    analyticsEnabled: true,
    reportsEnabled: true,
    supportLevel: 'dedicated' as const,
    isFeatured: false,
    sortOrder: 4,
  },
];

async function seedPlans(): Promise<void> {
  for (const plan of PLANS) {
    const existing = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, plan.code)).limit(1);
    if (existing[0]) {
      console.log(`[seed] plan "${plan.code}" already exists — leaving it untouched.`);
      continue;
    }
    await db.insert(plans).values(plan);
    console.log(`[seed] created plan "${plan.code}".`);
  }
}

async function seedSettings(): Promise<void> {
  const defaults: { key: string; value: Record<string, unknown> }[] = [
    {
      key: 'general',
      value: {
        platformName: config.mail.fromName,
        logoUrl: null,
        supportEmail: config.mail.fromEmail,
        supportPhone: null,
        defaultCurrency: config.payment.currency,
        timezone: 'UTC',
      },
    },
    { key: 'trial', value: { trialDays: DEFAULT_TRIAL_DAYS, reminderDays: DEFAULT_TRIAL_REMINDER_DAYS } },
    { key: 'email', value: { senderName: config.mail.fromName, senderEmail: config.mail.fromEmail } },
    { key: 'messaging', value: { smsProvider: null, whatsappProvider: null } },
  ];

  for (const entry of defaults) {
    const existing = await db
      .select({ id: systemSettings.id })
      .from(systemSettings)
      .where(eq(systemSettings.key, entry.key))
      .limit(1);

    if (existing[0]) continue;
    await db.insert(systemSettings).values(entry);
    console.log(`[seed] created settings group "${entry.key}".`);
  }
}

async function seedAdmin(): Promise<void> {
  const existing = await db.select({ id: companyAdmin.id, email: companyAdmin.email }).from(companyAdmin).limit(1);

  if (existing[0]) {
    console.log(`[seed] company admin already exists (${existing[0].email}) — the one-admin rule keeps it that way.`);
    return;
  }

  const password = config.bootstrapAdmin.password;
  if (!password) {
    console.warn('[seed] COMPANY_ADMIN_PASSWORD is not set — skipping admin creation.');
    console.warn('[seed] Set it in .env and re-run `npm run db:seed`.');
    return;
  }
  if (password.length < 12) {
    throw new Error('COMPANY_ADMIN_PASSWORD must be at least 12 characters.');
  }

  await db.insert(companyAdmin).values({
    email: config.bootstrapAdmin.email,
    passwordHash: await hashPassword(password),
    status: 'active',
  });

  console.log(`[seed] created the company admin (${config.bootstrapAdmin.email}).`);
  console.log('[seed] Sign in — a one-time passcode is emailed to this address.');
}

async function main(): Promise<void> {
  await seedPlans();
  await seedSettings();
  await seedAdmin();
  console.log('[seed] done.');
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
