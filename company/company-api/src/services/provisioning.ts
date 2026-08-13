import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { tenantAdminConnection } from '../db/tenant-connection';
import {
  clientAccounts,
  domains,
  plans,
  provisioningJobs,
  tenants,
  trials,
  subscriptions,
} from '../db/schema/index';
import { config, type TenantShard } from '../config/index';
import { locateShard, pickShardForNewTenant, resolveShard } from './tenant-shards';
import { logger } from '../lib/logger';
import { AppError, ERROR_CODES } from '../lib/errors';
import { PROVISIONING_STEPS, type ProvisioningStepName } from '../lib/constants';
import {
  addDays,
  buildClientAdminUrl,
  buildStorefrontUrl,
  platformSubdomain,
  tenantDatabaseName,
  validateSubdomain,
} from '../lib/utils';
import { generateToken } from '../lib/crypto';
import { recordActivity } from '../lib/audit';
import { invalidateTenantCacheFor } from '../lib/tenant-cache';
import { emails } from '../lib/mailer';
import { getTrialSettings } from '../lib/settings';
import { TENANT_BOOTSTRAP_SQL, TENANT_SCHEMA_VERSION } from './tenant-schema';

/** CREATE DATABASE cannot be parameterised, so the identifier is validated then quoted. */
function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new AppError(ERROR_CODES.PROVISIONING_FAILED, 'Unsafe tenant database name.', 500);
  }
  return `"${value}"`;
}

async function markStep(jobId: string, step: ProvisioningStepName, completed: string[]): Promise<string[]> {
  const next = completed.includes(step) ? completed : [...completed, step];
  await db
    .update(provisioningJobs)
    .set({ currentStep: step, completedSteps: next, updatedAt: new Date() })
    .where(eq(provisioningJobs.id, jobId));
  return next;
}

async function createTenantDatabase(shard: TenantShard, databaseName: string): Promise<void> {
  const client = tenantAdminConnection(shard);
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [databaseName]);
    if ((existing.rowCount ?? 0) === 0) {
      await client.query(`create database ${quoteIdentifier(databaseName)}`);
      logger.info({ databaseName, shard: shard.id }, 'tenant database created');
    } else {
      logger.warn({ databaseName, shard: shard.id }, 'tenant database already existed, reusing');
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function runTenantSchema(shard: TenantShard, databaseName: string): Promise<void> {
  const client = tenantAdminConnection(shard, databaseName);
  await client.connect();
  try {
    await client.query(TENANT_BOOTSTRAP_SQL);
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface StoreSeed {
  tenantRef: string;
  storeName: string;
  slug: string;
  currency: string;
  language: string;
  timezone: string;
  storefrontTemplate: string;
  storefrontUrl: string;
  adminUrl: string;
  planCode: string | null;
  ownerEmail: string;
  ownerName: string;
  ownerPasswordHash: string;
}

async function seedStoreConfiguration(
  shard: TenantShard,
  databaseName: string,
  seed: StoreSeed,
): Promise<void> {
  const client = tenantAdminConnection(shard, databaseName);
  await client.connect();
  try {
    await client.query(
      `insert into store_settings
         (tenant_ref, store_name, slug, currency, language, timezone, storefront_template, storefront_url, admin_url, plan_code)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (tenant_ref) do update set
         store_name = excluded.store_name,
         slug = excluded.slug,
         currency = excluded.currency,
         language = excluded.language,
         timezone = excluded.timezone,
         storefront_template = excluded.storefront_template,
         storefront_url = excluded.storefront_url,
         admin_url = excluded.admin_url,
         plan_code = excluded.plan_code,
         updated_at = now()`,
      [
        seed.tenantRef,
        seed.storeName,
        seed.slug,
        seed.currency,
        seed.language,
        seed.timezone,
        seed.storefrontTemplate,
        seed.storefrontUrl,
        seed.adminUrl,
        seed.planCode,
      ],
    );

    await client.query(
      `insert into platform_sync (key, value) values ('schema_version', $1::jsonb)
       on conflict (key) do update set value = excluded.value, synced_at = now()`,
      [JSON.stringify({ version: TENANT_SCHEMA_VERSION })],
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Creates the store's single admin account from the login the owner chose during
 * signup. The store admin panel has no sign-up or invite of its own — this row
 * *is* the login — so the password hash (never the password) is copied here.
 * Both platforms hash with the same Argon2id parameters, so the client API can
 * verify it directly.
 *
 * Written as update-then-insert rather than `ON CONFLICT`, because two unique
 * indexes guard this table and only one of them can be inferred at a time.
 * `store_admins_email_key` is the obvious one, but `store_admins_singleton_key`
 * — a unique index on a constant, so a store can never have two admins — is the
 * one an existing row with a *different* address collides with, and a conflict
 * clause naming the email index would not catch it. `createTenantDatabase`
 * deliberately reuses a database it finds already there, so that row is a case
 * that reaches here, and it used to surface as a raw unique-violation that
 * failed the whole build.
 *
 * A re-run never overwrites a hash that is already there: the owner may have
 * changed their password inside the panel since, and provisioning must not roll
 * that back. The address does move, because the address is what setup proved and
 * the company side is its only authority.
 */
async function seedStoreAdmin(shard: TenantShard, databaseName: string, seed: StoreSeed): Promise<void> {
  const client = tenantAdminConnection(shard, databaseName);
  await client.connect();
  try {
    // Scoped to one row by id rather than left unqualified: the singleton index
    // already makes a second row impossible, but a bare UPDATE would rewrite
    // every row in a tenant database old enough to predate that index.
    const updated = await client.query(
      `update store_admins set
         email         = $1,
         full_name     = $2,
         role          = 'owner',
         password_hash = coalesce(password_hash, $3),
         status        = case when password_hash is null then 'active' else status end,
         updated_at    = now()
       where id = (select id from store_admins order by created_at limit 1)
       returning id`,
      [seed.ownerEmail, seed.ownerName, seed.ownerPasswordHash],
    );

    if ((updated.rowCount ?? 0) > 0) return;

    await client.query(
      `insert into store_admins (email, full_name, role, status, password_hash)
       values ($1, $2, 'owner', 'active', $3)`,
      [seed.ownerEmail, seed.ownerName, seed.ownerPasswordHash],
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface ProvisionResult {
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Orchestrates tenant creation. Each step is recorded before the next begins, so
 * a retry resumes from where it stopped instead of starting over.
 */
export async function runProvisioning(tenantId: string): Promise<ProvisionResult> {
  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) throw new AppError(ERROR_CODES.TENANT_NOT_FOUND, 'Tenant not found.', 404);

  const accountRows = await db
    .select({
      id: clientAccounts.id,
      email: clientAccounts.email,
      fullName: clientAccounts.fullName,
      passwordHash: clientAccounts.passwordHash,
    })
    .from(clientAccounts)
    .where(eq(clientAccounts.id, tenant.clientAccountId))
    .limit(1);
  const account = accountRows[0];
  if (!account) throw new AppError(ERROR_CODES.TENANT_NOT_FOUND, 'Client account not found.', 404);

  const jobRows = await db
    .select()
    .from(provisioningJobs)
    .where(eq(provisioningJobs.tenantId, tenantId))
    .limit(1);

  let job = jobRows[0];
  if (!job) {
    const inserted = await db.insert(provisioningJobs).values({ tenantId }).returning();
    job = inserted[0]!;
  }

  if (job.status === 'completed') return { status: 'completed' };

  await db
    .update(provisioningJobs)
    .set({
      status: 'creating',
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
      attempts: String(Number(job.attempts ?? '0') + 1),
      updatedAt: new Date(),
    })
    .where(eq(provisioningJobs.id, job.id));

  await db
    .update(tenants)
    .set({ status: 'provisioning', storeStatus: 'creating', updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  let completed = job.completedSteps ?? [];

  try {
    // Re-validate the slug at the last responsible moment — the frontend check
    // was only a convenience and the value may have been tampered with.
    const slugCheck = validateSubdomain(tenant.slug);
    if (!slugCheck.ok) {
      throw new AppError(ERROR_CODES.SUBDOMAIN_INVALID, 'The store address is no longer valid.', 422);
    }

    const databaseName = tenant.databaseName ?? tenantDatabaseName(tenant.slug, config.tenantDb.namePrefix);

    // Which server this store's database lives on. An existing database always
    // wins: picking again would create a second, empty one on another shard and
    // repoint the tenant at it.
    //
    // `tenant.databaseName` is not the test for that — it is written when the
    // store is *named*, several steps before anything is created — so a store
    // that has never been built is asked for by name and the cluster is searched
    // for it. Only when no server has it is a shard chosen.
    const existingShard = tenant.databaseShard
      ? resolveShard(tenant.databaseShard)
      : await locateShard(databaseName);
    const shard: TenantShard = existingShard ?? (await pickShardForNewTenant());

    const subdomain = platformSubdomain(tenant.slug, config.urls.platformRootDomain);
    const storefrontUrl = buildStorefrontUrl(tenant.slug, config.urls.platformRootDomain);
    const adminUrl = buildClientAdminUrl(tenant.slug, config.urls.clientAdminPattern);

    // 1. Tenant record
    completed = await markStep(job.id, 'tenant_record', completed);

    // 2. Dedicated database
    if (!completed.includes('tenant_database')) {
      await createTenantDatabase(shard, databaseName);
      await db
        .update(tenants)
        .set({ databaseName, databaseShard: shard.id, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      completed = await markStep(job.id, 'tenant_database', completed);
    }

    // 3. Schema
    if (!completed.includes('tenant_schema')) {
      await runTenantSchema(shard, databaseName);
      completed = await markStep(job.id, 'tenant_schema', completed);
    }

    // Join through to the plan so `plan_code` gets the actual code (e.g. 'business').
    const subscriptionRows = await db
      .select({ planCode: plans.code })
      .from(subscriptions)
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);

    const seed: StoreSeed = {
      tenantRef: tenant.tenantRef,
      storeName: tenant.storeName,
      slug: tenant.slug,
      currency: tenant.currency,
      language: tenant.language,
      timezone: tenant.timezone,
      storefrontTemplate: tenant.storefrontTemplate,
      storefrontUrl,
      adminUrl,
      planCode: subscriptionRows[0]?.planCode ?? null,
      // Signup sets a login specifically for the store panel. Tenants created
      // before that step existed fall back to the SaaS account credential, which
      // is what they were provisioned with.
      ownerEmail: tenant.storeAdminEmail ?? account.email,
      ownerName: account.fullName,
      ownerPasswordHash: tenant.storeAdminPasswordHash ?? account.passwordHash,
    };

    // 4. Store configuration
    if (!completed.includes('store_configuration')) {
      await seedStoreConfiguration(shard, databaseName, seed);
      completed = await markStep(job.id, 'store_configuration', completed);
    }

    // 5. Store owner record. Once the credential is inside the tenant database
    // the staging copy here is redundant, so it is dropped — the live password
    // hash then exists in exactly one place.
    if (!completed.includes('store_admin')) {
      await seedStoreAdmin(shard, databaseName, seed);
      completed = await markStep(job.id, 'store_admin', completed);
      if (tenant.storeAdminPasswordHash) {
        await db
          .update(tenants)
          .set({ storeAdminPasswordHash: null, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));
      }
    }

    // 6. Platform subdomain
    if (!completed.includes('platform_subdomain')) {
      const existing = await db
        .select({ id: domains.id })
        .from(domains)
        .where(and(eq(domains.tenantId, tenantId), eq(domains.domainType, 'platform_subdomain')))
        .limit(1);

      if (!existing[0]) {
        await db.insert(domains).values({
          tenantId,
          domain: subdomain,
          domainType: 'platform_subdomain',
          isPrimary: true,
          verified: true,
          status: 'active',
          verificationToken: generateToken(16),
          verifiedAt: new Date(),
          lastCheckedAt: new Date(),
        });
      }
      completed = await markStep(job.id, 'platform_subdomain', completed);
    }

    // 7. Ready — and only now does the trial clock start.
    const trialRows = await db.select().from(trials).where(eq(trials.tenantId, tenantId)).limit(1);
    const trial = trialRows[0];
    const now = new Date();

    if (trial && trial.status === 'active' && !trial.startedAt) {
      const { trialDays } = await getTrialSettings();
      await db
        .update(trials)
        .set({ startedAt: now, endsAt: addDays(now, trialDays), updatedAt: now })
        .where(eq(trials.id, trial.id));

      await recordActivity({
        type: 'trial_started',
        title: 'Trial started',
        subject: tenant.storeName,
        clientAccountId: account.id,
        tenantId,
      });
    }

    await db
      .update(tenants)
      .set({
        status: trial && trial.status === 'active' ? 'trial' : 'active',
        storeStatus: 'ready',
        activatedAt: tenant.activatedAt ?? now,
        updatedAt: now,
      })
      .where(eq(tenants.id, tenantId));

    completed = await markStep(job.id, 'store_ready', completed);

    await db
      .update(provisioningJobs)
      .set({ status: 'completed', completedAt: now, errorMessage: null, updatedAt: now })
      .where(eq(provisioningJobs.id, job.id));

    // The client platform caches "no such store" for a few seconds while a store
    // is being built. Clearing it here is what lets the owner's first visit work
    // instead of meeting a 404 the cache is still holding.
    await invalidateTenantCacheFor(tenant.slug, [subdomain]);

    await recordActivity({
      type: 'store_provisioned',
      title: 'Store provisioned',
      subject: tenant.storeName,
      clientAccountId: account.id,
      tenantId,
    });

    await emails.storeReady(account.email, account.fullName, storefrontUrl, adminUrl, seed.ownerEmail, {
      clientAccountId: account.id,
      tenantId,
    });

    logger.info({ tenantId, slug: tenant.slug }, 'provisioning completed');
    return { status: 'completed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed.';
    logger.error({ tenantId, err: message }, 'provisioning failed');

    await db
      .update(provisioningJobs)
      .set({ status: 'failed', errorMessage: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(provisioningJobs.id, job.id));

    await db
      .update(tenants)
      .set({ status: 'pending', storeStatus: 'failed', updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    // Surfaced in the admin notification feed — a failed store is the single
    // most time-sensitive event on the platform.
    await recordActivity({
      type: 'provisioning_failed',
      title: 'Provisioning failed',
      subject: tenant.storeName,
      clientAccountId: account.id,
      tenantId,
      metadata: { error: message.slice(0, 200) },
    });

    return { status: 'failed', error: message };
  }
}

export function provisioningStepsView(completed: string[] | null | undefined) {
  const done = new Set(completed ?? []);
  return PROVISIONING_STEPS.map((step) => ({ step, done: done.has(step) }));
}
